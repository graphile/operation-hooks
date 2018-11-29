import { Plugin, Build, Context } from "graphile-build";
import { OperationHookCallback, OperationHook } from "./OperationHooksPlugin";
import { PgProc, PgType } from "graphile-build-pg";
import { GraphQLResolveInfoWithMessages } from "./OperationMessagesPlugin";

type BeforeOrAfter = "before" | "after";
const JSON_TYPE_ID = "114";
const JSONB_TYPE_ID = "3802";

interface FunctionSpec {
  isArray: boolean;
}

function getFunctionSpec(build: Build, proc: PgProc): FunctionSpec {
  const { pgIntrospectionResultsByKind: introspectionResultsByKind } = build;
  const argModesWithOutput = [
    "o", // OUT,
    "b", // INOUT
    "t", // TABLE
  ];
  const argTypes: PgType[] = [];
  const outputArgNames: string[] = [];
  const outputArgTypes: PgType[] = [];
  proc.argTypeIds.forEach((typeId, idx) => {
    if (
      proc.argModes.length === 0 || // all args are `in`
      proc.argModes[idx] === "i" || // this arg is `in`
      proc.argModes[idx] === "b" // this arg is `inout`
    ) {
      argTypes.push(introspectionResultsByKind.typeById[typeId]);
    }
    if (argModesWithOutput.includes(proc.argModes[idx])) {
      outputArgNames.push(proc.argNames[idx] || "");
      outputArgTypes.push(introspectionResultsByKind.typeById[typeId]);
    }
  });

  const rawReturnType: PgType =
    introspectionResultsByKind.typeById[proc.returnTypeId];

  if (argTypes.length !== 1) {
    throw new Error(
      `Function ${proc.namespaceName}.${
        proc.name
      }(...) should accept exactly one input argument`
    );
  }
  if (argTypes[0].id !== JSON_TYPE_ID && argTypes[0].id !== JSONB_TYPE_ID) {
    throw new Error(
      `Function ${proc.namespaceName}.${
        proc.name
      }(...)'s argument should be either JSON or JSONB`
    );
  }

  // TODO: assert that 'level' and 'message' are exposed
  // TODO: return a type for this

  return {
    isArray: rawReturnType.isPgArray,
  };
}

function sqlFunctionToCallback(
  build: Build,
  proc: PgProc
): OperationHookCallback {
  const spec = getFunctionSpec(build, proc);
  return async (
    input,
    args,
    context,
    resolveInfo: GraphQLResolveInfoWithMessages
  ) => {
    const {
      graphileMeta: { messages },
    } = resolveInfo;
    const sql = build.pgSql;
    const { pgClient } = context;

    // Call the function
    const sqlFunctionCall = sql.fragment`${sql.identifier(
      proc.namespaceName,
      proc.name
    )}(${sql.value(JSON.stringify(args))}::json)`;
    const source = spec.isArray
      ? sql.fragment`unnest(${sqlFunctionCall})`
      : sqlFunctionCall;
    const sqlQuery = sql.query`select * from ${source};`;

    const compiled = sql.compile(sqlQuery);
    const { rows } = await pgClient.query(compiled);

    // Process the results, add to messages
    messages.push(...rows);

    // Return input unmodified
    return input;
  };
}

function getCallSQLFunction(
  build: Build,
  fieldContext: Context<any>,
  when: BeforeOrAfter
): OperationHookCallback | null {
  const name = build.inflection.pgOperationHookFunctionName(fieldContext, when);
  const sqlFunction = build.pgIntrospectionResultsByKind.procedure.find(
    (proc: PgProc) => proc.name === name
  );
  if (sqlFunction) {
    return sqlFunctionToCallback(build, sqlFunction);
  }
  return null;
}

const PgOperationHooksPlugin: Plugin = function PgOperationHooksPlugin(
  builder
) {
  builder.hook("inflection", (inflection, build) =>
    build.extend(inflection, {
      pgOperationHookFunctionName: (
        fieldContext: Context<any>,
        when: BeforeOrAfter
      ) => {
        const {
          scope: { fieldName, isRootQuery, isRootMutation, isRootSubscription },
        } = fieldContext;
        const operationType = isRootQuery
          ? "query"
          : isRootMutation
          ? "mutation"
          : isRootSubscription
          ? "subscription"
          : null;
        if (operationType === null) {
          throw new Error("Invalid fieldContext passed to inflector");
        }
        return `${operationType}_${fieldName}_${when.toLowerCase()}`;
      },
    })
  );
  builder.hook("init", (_, build) => {
    if (!build.pgIntrospectionResultsByKind) {
      // Clearly we're not running in PostGraphile, abort.
      return _;
    }
    const hookGenerator: OperationHookCallback = fieldContext => {
      const hook: OperationHook = { before: [], after: [] };
      const callBeforeSQLFunction = getCallSQLFunction(
        build,
        fieldContext,
        "before"
      );
      const callAfterSQLFunction = getCallSQLFunction(
        build,
        fieldContext,
        "after"
      );
      if (!callAfterSQLFunction && !callBeforeSQLFunction) {
        return null;
      }
      if (callBeforeSQLFunction) {
        hook.before!.push({ priority: 500, callback: callBeforeSQLFunction });
      }
      if (callAfterSQLFunction) {
        hook.after!.push({ priority: 500, callback: callAfterSQLFunction });
      }
      return hook;
    };
    build.addOperationHook(hookGenerator);
    return _;
  });
};

export default PgOperationHooksPlugin;
