"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fieldHelpers_1 = require("graphile-utils/node8plus/fieldHelpers");
const JSON_TYPE_ID = "114";
const JSONB_TYPE_ID = "3802";
const get = (obj, path) => {
    let ret = obj;
    // tslint:disable no-conditional-assignment
    for (let i = 0, l = path.length; i < l; i++) {
        if (ret == null) {
            return ret;
        }
        ret = ret[path[i]];
    }
    return ret;
};
function getFunctionSpec(build, proc, sqlOp, when, scope) {
    const { pgFieldIntrospection: table, pgFieldConstraint: constraint, isPgNodeMutation, fieldName, } = scope;
    const { pgSql: sql, nodeIdFieldName, getTypeAndIdentifiersFromNodeId, pgGetGqlTypeByTypeIdAndModifier, gql2pg, inflection, pgIntrospectionResultsByKind: introspectionResultsByKind, } = build;
    const TableType = pgGetGqlTypeByTypeIdAndModifier(table.type.id, null);
    const argModesWithOutput = [
        "o",
        "b",
        "t",
    ];
    const inputArgTypes = [];
    const outputArgNames = [];
    const outputArgTypes = [];
    proc.argTypeIds.forEach((typeId, idx) => {
        if (proc.argModes.length === 0 || // all args are `in`
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
    const rawReturnType = introspectionResultsByKind.typeById[proc.returnTypeId];
    const hasJson = inputArgTypes.length >= 1;
    const hasRow = inputArgTypes.length >= 2;
    const hasOp = inputArgTypes.length >= 3;
    if (inputArgTypes.length > 3) {
        throw new Error(`Function '${proc.namespaceName}.${proc.name}' accepts too many arguments`);
    }
    if (hasJson &&
        inputArgTypes[0].id !== JSON_TYPE_ID &&
        inputArgTypes[0].id !== JSONB_TYPE_ID) {
        throw new Error(`Function ${proc.namespaceName}.${proc.name}(...)'s first argument should be either JSON or JSONB`);
    }
    const primaryKeyConstraint = table.primaryKeyConstraint;
    const primaryKeys = primaryKeyConstraint && primaryKeyConstraint.keyAttributes;
    const sqlTable = sql.identifier(table.namespaceName, table.name);
    let path = [];
    if (sqlOp === "insert") {
        const inputFieldName = inflection.tableFieldName(table);
        path = ["input", inputFieldName];
    }
    else if (sqlOp === "update") {
        const inputFieldName = inflection.patchField(inflection.tableFieldName(table));
        path = ["input", inputFieldName];
    }
    else {
        // Nothing
        path = [];
    }
    const makeArgs = (args, input) => {
        const parts = [];
        if (hasJson) {
            const data = path.length ? get(args, path) : null;
            parts.push(sql.fragment `${sql.value(data ? JSON.stringify(data) : null)}::${sql.identifier(inputArgTypes[0].name)}`);
        }
        if (hasRow) {
            let rowSql;
            if ((sqlOp === "insert" && when === "before") ||
                (sqlOp === "delete" && when === "after")) {
                rowSql = sql.null;
            }
            else {
                if ((sqlOp === "insert" || sqlOp === "update") && when === "after") {
                    if (!primaryKeyConstraint) {
                        throw new Error(`Table has no primary key, cannot pass row to ${proc.namespaceName}.${proc.name}`);
                    }
                    const sqlTuple = sql.identifier(Symbol());
                    rowSql = sql.fragment `(select ${sqlTuple} from ${sqlTable} ${sqlTuple} where (${sql.join(primaryKeyConstraint.keyAttributes.map((key) => sql.fragment `${sql.identifier(key.name)} = ${gql2pg(input.data[`@ophookpk__${key.name}`], key.type, key.typeModifier)}`), ") and (")}))`;
                }
                else if (constraint) {
                    const sqlTuple = sql.identifier(Symbol());
                    rowSql = sql.fragment `(select ${sqlTuple} from ${sqlTable} ${sqlTuple} where (${sql.join(constraint.keyAttributes.map((key) => sql.fragment `${sql.identifier(key.name)} = ${gql2pg(args.input[inflection.column(key)], key.type, key.typeModifier)}`), ") and (")}))`;
                }
                else if (isPgNodeMutation) {
                    const nodeId = args.input[nodeIdFieldName];
                    const { Type, identifiers } = getTypeAndIdentifiersFromNodeId(nodeId);
                    if (Type !== TableType) {
                        throw new Error("Mismatched type");
                    }
                    if (identifiers.length !== primaryKeys.length) {
                        throw new Error("Invalid ID");
                    }
                    const sqlTuple = sql.identifier(Symbol());
                    rowSql = sql.fragment `(select ${sqlTuple} from ${sqlTable} ${sqlTuple} where (${sql.join(primaryKeys.map((key, idx) => sql.fragment `${sqlTuple}.${sql.identifier(key.name)} = ${gql2pg(identifiers[idx], key.type, key.typeModifier)}`), ") and (")}))`;
                }
                else {
                    throw new Error(`Don't know how to determine row for PgOperationHooksPlugin, mutation '${fieldName}'`);
                }
            }
            parts.push(sql.fragment `${rowSql}::${sql.identifier(table.namespaceName, table.name)}`);
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
        path,
    };
}
function sqlFunctionToCallback(build, proc, sqlOp, when, scope) {
    const spec = getFunctionSpec(build, proc, sqlOp, when, scope);
    return async (input, args, context, resolveInfo) => {
        const { graphileMeta: { messages }, } = resolveInfo;
        const sql = build.pgSql;
        const { pgClient } = context;
        // Call the function
        const sqlFunctionCall = sql.fragment `${sql.identifier(proc.namespaceName, proc.name)}(${spec.makeArgs(args, input)})`;
        // )}(${sql.value(JSON.stringify(args))}::json)`;
        const source = spec.isArray
            ? sql.fragment `unnest(${sqlFunctionCall})`
            : sqlFunctionCall;
        const sqlQuery = sql.query `select * from ${source};`;
        const compiled = sql.compile(sqlQuery);
        const { rows } = await pgClient.query(compiled);
        // Process the results, add to messages
        messages.push(...rows.map((msg) => ({
            ...msg,
            path: msg.path ? [...spec.path, ...msg.path] : null,
        })));
        // Return input unmodified
        return input;
    };
}
const matchContext = (fieldContext) => {
    const { scope } = fieldContext;
    const { isRootMutation, isPgUpdateMutationField, isPgDeleteMutationField, isPgCreateMutationField, pgFieldIntrospection: table, } = scope;
    if (!isRootMutation || !table) {
        return null;
    }
    if (table.kind !== "class") {
        return null;
    }
    const sqlOp = isPgCreateMutationField
        ? "insert"
        : isPgUpdateMutationField
            ? "update"
            : isPgDeleteMutationField
                ? "delete"
                : null;
    if (sqlOp === null) {
        return null;
    }
    return {
        table,
        sqlOp,
    };
};
function getCallSQLFunction(build, fieldContext, when) {
    const match = matchContext(fieldContext);
    if (!match) {
        return null;
    }
    const { table, sqlOp } = match;
    const name = build.inflection.pgOperationHookFunctionName(table, sqlOp, when, fieldContext);
    const sqlFunction = build.pgIntrospectionResultsByKind.procedure.find((proc) => proc.name === name);
    if (sqlFunction) {
        return sqlFunctionToCallback(build, sqlFunction, sqlOp, when, fieldContext.scope);
    }
    return null;
}
// tslint:disable-next-line no-shadowed-variable
const PgOperationHooksPlugin = function PgOperationHooksPlugin(builder) {
    builder.hook("inflection", (inflection, build) => build.extend(inflection, {
        pgOperationHookFunctionName: (table, sqlOp, when, _fieldContext) => {
            return `${table.name}_${sqlOp}_${when.toLowerCase()}`;
        },
    }));
    builder.hook("GraphQLObjectType:fields:field", (field, build, context) => {
        const match = matchContext(context);
        if (!match || match.sqlOp === "delete") {
            return field;
        }
        // INSERT or UPDATE, we need to request the primary key(s)
        const primaryKeyConstraint = match.table.primaryKeyConstraint;
        if (!primaryKeyConstraint) {
            return field;
        }
        // Request the fields...
        primaryKeyConstraint.keyAttributes.forEach((attr) => fieldHelpers_1.requireChildColumn(build, context, attr.name, `@ophookpk__${attr.name}`));
        return field;
    });
    builder.hook("init", (_, build) => {
        if (!build.pgIntrospectionResultsByKind) {
            // Clearly we're not running in PostGraphile, abort.
            return _;
        }
        const hookGenerator = fieldContext => {
            const hook = { before: [], after: [] };
            const callBeforeSQLFunction = getCallSQLFunction(build, fieldContext, "before");
            const callAfterSQLFunction = getCallSQLFunction(build, fieldContext, "after");
            if (!callAfterSQLFunction && !callBeforeSQLFunction) {
                return null;
            }
            if (callBeforeSQLFunction) {
                hook.before.push({ priority: 500, callback: callBeforeSQLFunction });
            }
            if (callAfterSQLFunction) {
                hook.after.push({ priority: 500, callback: callAfterSQLFunction });
            }
            return hook;
        };
        build.addOperationHook(hookGenerator);
        return _;
    });
};
exports.default = PgOperationHooksPlugin;
