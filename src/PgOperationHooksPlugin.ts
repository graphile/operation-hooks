import { Plugin, Build, Context, Scope } from "graphile-build";
import { OperationHookCallback, OperationHook } from "./OperationHooksPlugin";
import { PgClass, PgProc, PgType, PgAttribute } from "graphile-build-pg";
import { GraphQLResolveInfoWithMessages } from "./OperationMessagesPlugin";

type SQL = any;
type BeforeOrAfter = "before" | "after";
type SqlOp = "insert" | "update" | "delete";
const JSON_TYPE_ID = "114";
const JSONB_TYPE_ID = "3802";

interface FunctionSpec {
  isArray: boolean;
  makeArgs(args: any): SQL;
}

function getFunctionSpec(
  build: Build,
  proc: PgProc,
  sqlOp: SqlOp,
  scope: Scope<any>
): FunctionSpec {
  const {
    pgFieldIntrospection: table,
    pgFieldConstraint: constraint,
    isPgNodeMutation,
    fieldName,
  } = scope;
  const {
    pgSql: sql,
    nodeIdFieldName,
    getTypeAndIdentifiersFromNodeId,
    pgGetGqlTypeByTypeIdAndModifier,
    gql2pg,
    inflection,
    pgIntrospectionResultsByKind: introspectionResultsByKind,
  } = build;
  const TableType = pgGetGqlTypeByTypeIdAndModifier(table.type.id, null);
  const argModesWithOutput = [
    "o", // OUT,
    "b", // INOUT
    "t", // TABLE
  ];
  const inputArgTypes: PgType[] = [];
  const outputArgNames: string[] = [];
  const outputArgTypes: PgType[] = [];
  proc.argTypeIds.forEach((typeId, idx) => {
    if (
      proc.argModes.length === 0 || // all args are `in`
      proc.argModes[idx] === "i" || // this arg is `in`
      proc.argModes[idx] === "b" // this arg is `inout`
    ) {
      inputArgTypes.push(introspectionResultsByKind.typeById[typeId]);
    }
    if (argModesWithOutput.includes(proc.argModes[idx])) {
      outputArgNames.push(proc.argNames[idx] || "");
      outputArgTypes.push(introspectionResultsByKind.typeById[typeId]);
    }
  });

  const rawReturnType: PgType =
    introspectionResultsByKind.typeById[proc.returnTypeId];

  const hasJson = inputArgTypes.length >= 1;
  const hasRow = inputArgTypes.length >= 2;
  const hasOp = inputArgTypes.length >= 3;
  if (inputArgTypes.length > 3) {
    throw new Error(
      `Function '${proc.namespaceName}.${proc.name}' accepts too many arguments`
    );
  }

  if (
    hasJson &&
    inputArgTypes[0].id !== JSON_TYPE_ID &&
    inputArgTypes[0].id !== JSONB_TYPE_ID
  ) {
    throw new Error(
      `Function ${proc.namespaceName}.${
        proc.name
      }(...)'s first argument should be either JSON or JSONB`
    );
  }

  const primaryKeyConstraint = table.primaryKeyConstraint;
  const primaryKeys =
    primaryKeyConstraint && primaryKeyConstraint.keyAttributes;

  const sqlTable = sql.identifier(table.namespaceName, table.name);

  const makeArgs = (args: any): any => {
    const parts = [];
    if (hasJson) {
      parts.push(
        sql.fragment`${sql.value(JSON.stringify(args))}::${sql.identifier(
          inputArgTypes[0].name
        )}`
      );
    }
    if (hasRow) {
      let rowSql: SQL;
      if (sqlOp === "insert") {
        rowSql = sql.null;
      } else if (constraint) {
        const sqlTuple = sql.identifier(Symbol());
        rowSql = sql.fragment`(select ${sqlTuple} from ${sqlTable} ${sqlTuple} where (${sql.join(
          constraint.keyAttributes.map(
            (key: PgAttribute) =>
              sql.fragment`${sql.identifier(key.name)} = ${gql2pg(
                args.input[inflection.column(key)],
                key.type,
                key.typeModifier
              )}`
          ),
          ") and ("
        )}))`;
      } else if (isPgNodeMutation) {
        const nodeId = args.input[nodeIdFieldName];
        const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(nodeId);
        if (Type !== TableType) {
          throw new Error("Mismatched type");
        }
        if (identifiers.length !== primaryKeys.length) {
          throw new Error("Invalid ID");
        }
        const sqlTuple = sql.identifier(Symbol());
        rowSql = sql.fragment`(select ${sqlTuple} from ${sqlTable} ${sqlTuple} where (${sql.join(
          primaryKeys.map(
            (key: PgAttribute, idx: number) =>
              sql.fragment`${sql.identifier(sqlTuple, key.name)} = ${gql2pg(
                identifiers[idx],
                key.type,
                key.typeModifier
              )}`
          ),
          ") and ("
        )}))`;
      } else {
        throw new Error(
          `Don't know how to determine row for PgOperationHooksPlugin, mutation '${fieldName}'`
        );
      }
      parts.push(
        sql.fragment`${rowSql}::${sql.identifier(
          table.namespaceName,
          table.name
        )}`
      );
    }
    if (hasOp) {
      parts.push(sql.literal(sqlOp));
    }

    // JSON or JSONB
    return sql.join(parts, ", ");
  };

  // TODO: assert that 'level' and 'message' are exposed
  // TODO: return a type for this

  return {
    isArray: rawReturnType.isPgArray,
    makeArgs,
  };
}

function sqlFunctionToCallback(
  build: Build,
  proc: PgProc,
  sqlOp: SqlOp,
  scope: Scope<any>
): OperationHookCallback {
  const spec = getFunctionSpec(build, proc, sqlOp, scope);
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
    )}(${spec.makeArgs(args)})`;
    // )}(${sql.value(JSON.stringify(args))}::json)`;
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
  const { scope } = fieldContext;
  const {
    isRootMutation,
    isRootSubscription,
    isPgUpdateMutationField,
    isPgDeleteMutationField,
    isPgCreateMutationField,
    pgFieldIntrospection: table,
  } = scope;
  if (!isRootMutation && !isRootSubscription) {
    return null;
  }
  if (table.kind !== "class") {
    return null;
  }
  const sqlOp: SqlOp | null = isPgCreateMutationField
    ? "insert"
    : isPgUpdateMutationField
    ? "update"
    : isPgDeleteMutationField
    ? "delete"
    : null;
  if (sqlOp === null) {
    return null;
  }
  const name = build.inflection.pgOperationHookFunctionName(
    table,
    sqlOp,
    when,
    fieldContext
  );
  const sqlFunction = build.pgIntrospectionResultsByKind.procedure.find(
    (proc: PgProc) => proc.name === name
  );
  if (sqlFunction) {
    return sqlFunctionToCallback(build, sqlFunction, sqlOp, scope);
  }
  return null;
}

const PgOperationHooksPlugin: Plugin = function PgOperationHooksPlugin(
  builder
) {
  builder.hook("inflection", (inflection, build) =>
    build.extend(inflection, {
      pgOperationHookFunctionName: (
        table: PgClass,
        sqlOp: SqlOp,
        when: BeforeOrAfter,
        _fieldContext: Context<any>
      ) => {
        return `${table.name}_${sqlOp}_${when.toLowerCase()}`;
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
