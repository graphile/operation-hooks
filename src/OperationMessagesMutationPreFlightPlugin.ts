import { Plugin, Context } from "graphile-build";
import { GraphQLResolveInfoWithMessages } from "./OperationMessagesPlugin";

const OperationMessagesMutationPreFlightPlugin: Plugin = function OperationMessagesMutationPreFlightPlugin(
  builder,
  { operationMessagesPreflight }
) {
  if (!operationMessagesPreflight) return;
  builder.hook("init", (_, build) => {
    build.addOperationHook((fieldContext: Context<any>) => {
      const {
        scope: { isRootMutation },
      } = fieldContext;
      if (!isRootMutation) {
        return null;
      }
      return {
        before: [
          {
            // Right at the end
            priority: 990,
            callback: (
              input: any,
              args: { [key: string]: any },
              _context: any,
              resolveInfo: GraphQLResolveInfoWithMessages
            ) =>
              args.preflight
                ? {
                    preflight: true,
                    query: build.$$isQuery,
                    ["#messages"]: resolveInfo.graphileMeta.messages,
                  }
                : input,
          },
        ],
      };
    });
    return _;
  });

  builder.hook("GraphQLObjectType:fields", (fields, build, context) => {
    const {
      graphql: { GraphQLBoolean, GraphQLNonNull },
    } = build;
    const {
      scope: { isMutationPayload },
    } = context;
    if (!isMutationPayload) {
      return fields;
    }
    return build.extend(fields, {
      preflight: {
        type: new GraphQLNonNull(GraphQLBoolean),
        resolve: (parent: any) => parent && !!parent.preflight,
      },
    });
  });

  builder.hook(
    "GraphQLObjectType:fields:field:args",
    (args, build, context) => {
      const {
        graphql: { GraphQLBoolean },
      } = build;
      const {
        scope: { isRootMutation },
      } = context;
      if (!isRootMutation) {
        return args;
      }
      return build.extend(args, {
        preflight: {
          type: GraphQLBoolean,
        },
      });
    }
  );
};

export default OperationMessagesMutationPreFlightPlugin;
