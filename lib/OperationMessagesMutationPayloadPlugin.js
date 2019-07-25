"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const OperationMessagesMutationPayloadPlugin = function OperationMessagesMutationPayloadPlugin(builder, { operationMessages }) {
    if (!operationMessages)
        return;
    builder.hook("inflection", (inflection, build) => {
        return build.extend(inflection, {
            operationMessageInterfaceName: () => "OperationMessageInterface",
            operationMessageName: () => "OperationMessage",
        });
    });
    builder.hook("init", (_, build) => {
        const { graphql: { GraphQLInterfaceType, GraphQLObjectType, GraphQLNonNull, GraphQLString, GraphQLList, }, newWithHooks, getTypeByName, } = build;
        const OperationMessageInterface = newWithHooks(GraphQLInterfaceType, {
            name: build.inflection.operationMessageInterfaceName(),
            // Override this function when you add other subtypes
            resolveType: (_object) => (_object &&
                _object.__typename &&
                getTypeByName(_object.__typename)) ||
                OperationMessage,
            fields: {
                level: {
                    type: new GraphQLNonNull(GraphQLString),
                    description: "The classification or severity of this message.",
                },
                message: {
                    type: new GraphQLNonNull(GraphQLString),
                    description: "A human readable message to be used when the client does not know how to interpret this message.",
                },
                path: {
                    type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
                    description: "A list of path components to the location in the input at which this message was generated.",
                },
            },
        }, {
            isOperationMessageInterface: true,
        });
        const OperationMessage = newWithHooks(GraphQLObjectType, {
            name: build.inflection.operationMessageName(),
            interfaces: [OperationMessageInterface],
            fields: {
                level: {
                    type: new GraphQLNonNull(GraphQLString),
                    description: "The classification or severity of this message.",
                },
                message: {
                    type: new GraphQLNonNull(GraphQLString),
                    description: "A human readable message to be used when the client does not know how to interpret this message.",
                },
                path: {
                    type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
                    description: "A list of path components to the location in the input at which this message was generated.",
                },
            },
        }, {
            isBaseOperationMessageType: true,
            isOperationMessageType: true,
        });
        build.addOperationHook((fieldContext) => {
            const { scope: { isRootMutation }, } = fieldContext;
            if (!isRootMutation) {
                return null;
            }
            return {
                after: [
                    {
                        // Right at the end!
                        priority: 950,
                        callback(result, _args, _context, resolveInfo) {
                            return {
                                ...result,
                                // Weird key to prevent accidental overwriting
                                ["#messages"]: resolveInfo.graphileMeta.messages,
                            };
                        },
                    },
                ],
            };
        });
        return _;
    });
    builder.hook("GraphQLObjectType:fields", (fields, build, context) => {
        const { graphql: { GraphQLList }, getTypeByName, } = build;
        const { scope: { isMutationPayload }, } = context;
        if (!isMutationPayload) {
            return fields;
        }
        const OperationMessageInterface = getTypeByName(build.inflection.operationMessageInterfaceName());
        if (!OperationMessageInterface) {
            throw new Error("Plugin ordering error: OperationMessageInterface was not generated in time?");
        }
        return build.extend(fields, {
            messages: {
                type: new GraphQLList(OperationMessageInterface),
                resolve(payload) {
                    return payload["#messages"];
                },
            },
        });
    });
    // @ts-ignore TypeScript definition issue in graphile-build@4.1.0-rc.2
    builder.hook("GraphQLSchema", (schema, build) => {
        const { getTypeByName } = build;
        const OperationMessage = getTypeByName(build.inflection.operationMessageName());
        if (!schema.types) {
            schema.types = [];
        }
        if (schema.types.indexOf(OperationMessage) < 0) {
            schema.types.push(OperationMessage);
        }
        return schema;
    });
};
exports.default = OperationMessagesMutationPayloadPlugin;
