import { Plugin, Build, Context } from "graphile-build";
import { OperationHookCallback, OperationHook } from "./OperationHooksPlugin";
import { PgProc } from "graphile-build-pg";
import { GraphQLResolveInfoWithMessages } from "./OperationMessagesPlugin";

type BeforeOrAfter = "before" | "after";
const JSON_TYPE_ID = "114";
const JSONB_TYPE_ID = "3802";

function assertValidCallbackFunc(_build: Build, proc: PgProc): void {
  if (proc.argTypeIds.length !== 1) {
    throw new Error(
      `Function ${proc.namespaceName}.${
        proc.name
      }(...) should accept exactly one argument`
    );
  }
  if (
    proc.argTypeIds[0] !== JSON_TYPE_ID &&
    proc.argTypeIds[0] !== JSONB_TYPE_ID
  ) {
    throw new Error(
      `Function ${proc.namespaceName}.${
        proc.name
      }(...)'s argument should be either JSON or JSONB`
    );
  }
  // TODO: assert return type
}

function sqlFunctionToCallback(
  build: Build,
  proc: PgProc
): OperationHookCallback {
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
    const sqlQuery = sql.query`select * from ${sql.identifier(
      proc.namespaceName,
      proc.name
    )}(${sql.value(JSON.stringify(args))}::json)`;
    const compiled = sql.compile(sqlQuery);
    const { rows } = await pgClient.query(compiled);

    // Process the results, add to messages
    console.log(rows); // TODO
    messages.push({
      level: "info",
      message: "TODO! IF THIS IS IN A SNAPSHOT IT'S AN ERROR!",
    });

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
    assertValidCallbackFunc(build, sqlFunction);
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
