import { Plugin } from "graphile-build";
import { OperationHookCallback, OperationHook } from "./OperationHooksPlugin";
import { GraphQLResolveInfoWithMessages } from "./OperationMessagesPlugin";
import * as assert from "assert";

const PgNoticeMessagesPlugin: Plugin = function PgNoticeMessagesPlugin(
  builder
) {
  builder.hook("init", (_, build) => {
    const hookGenerator: OperationHookCallback = fieldContext => {
      if (!fieldContext.scope.isRootMutation) {
        // We absolutely cannot support isRootQuery because root query resolvers
        // run in parallel, all using the same PG client, so we wouldn't know
        // which field a notice applied to. We need the Postgres client to only
        // do this one thing.
        return null;
      }

      const makeProcessNotice = (
        resolveInfo: GraphQLResolveInfoWithMessages
      ) => (msg: any) => {
        // TODO
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: `NOTICE! ${msg.message}`,
        });
      };
      let processNotice: ((msg: any) => void) | null = null;

      const registerNotifyListener: OperationHookCallback = (
        input,
        _args,
        context,
        resolveInfo: GraphQLResolveInfoWithMessages
      ) => {
        assert(!processNotice, "processNotice should not be set yet!");
        if (!context || !context.pgClient) {
          // Not a PostGraphile dispatch (no client) - just return
          return input;
        }
        processNotice = makeProcessNotice(resolveInfo);
        context.pgClient.on("notice", processNotice);
        return input;
      };

      const unregisterNotifyListener: OperationHookCallback = (
        input,
        _args,
        context,
        _resolveInfo: GraphQLResolveInfoWithMessages
      ) => {
        if (processNotice) {
          context.pgClient.removeListener("notice", processNotice);
        }
        return input;
      };

      const hook: OperationHook = {
        before: [{ priority: 100, callback: registerNotifyListener }],
        finally: [{ priority: 500, callback: unregisterNotifyListener }],
      };

      return hook;
    };

    build.addOperationHook(hookGenerator);
    return _;
  });
};

export default PgNoticeMessagesPlugin;
