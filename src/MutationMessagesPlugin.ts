import { Plugin, Context } from "graphile-build";
import {
  OperationHookCallback,
  GraphQLResolveInfoWithMeta,
} from "./OperationHooksPlugin";

interface Message {
  level: string;
  message: string;
  path?: string[];
}

interface GraphQLResolveInfoWithMessages extends GraphQLResolveInfoWithMeta {
  graphileMeta: {
    messages: Message[];
  };
}

const addMessagesToMeta: OperationHookCallback = (
  _,
  _args,
  _context,
  resolveInfo: GraphQLResolveInfoWithMessages
) => {
  resolveInfo.graphileMeta.messages = [];
  return _;
};

const validateMessages: OperationHookCallback = (
  _,
  _args,
  _context,
  resolveInfo: GraphQLResolveInfoWithMessages
) => {
  const firstError = resolveInfo.graphileMeta.messages.find(
    message => message.level === "ERROR"
  );
  if (firstError) {
    throw new Error(
      `Aborting ${resolveInfo.fieldName} due to error: ${firstError.message}`
    );
  }
  return _;
};

const addMessagesToError: OperationHookCallback = (
  error,
  _args,
  _context,
  resolveInfo: GraphQLResolveInfoWithMessages
) => {
  error.extensions = error.extensions || {};
  error.extensions.messages = resolveInfo.graphileMeta.messages;
  return error;
};

const MutationMessagesPlugin: Plugin = function MutationMessagesPlugin(
  builder
) {
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
          { priority: 100, callback: addMessagesToMeta },
          { priority: 900, callback: validateMessages },
        ],
        after: [{ priority: 900, callback: validateMessages }],
        error: [{ priority: 500, callback: addMessagesToError }],
      };
    });
    return _;
  });
};

export default MutationMessagesPlugin;
