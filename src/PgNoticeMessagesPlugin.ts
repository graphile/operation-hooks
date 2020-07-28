import { Plugin } from "graphile-build";
import { OperationHookCallback, OperationHook } from "./OperationHooksPlugin";
import { GraphQLResolveInfoWithMessages } from "./OperationMessagesPlugin";
import * as assert from "assert";

const PgNoticeMessagesPlugin: Plugin = function PgNoticeMessagesPlugin(
  builder
) {
  builder.hook("init", (_, build) => {
    const hookGenerator: OperationHookCallback = (fieldContext) => {
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
        if (msg.code !== "OPMSG") {
          // We only care about OPMSG NOTICEs
          return;
        }
        // TODO
        let json: any = null;
        try {
          json = JSON.parse(msg.detail);
        } catch (e) {
          console.dir(msg);
          console.error("Failed to parse above OPMSG NOTICE from PostgreSQL");
          console.error(e);
        }
        resolveInfo.graphileMeta.messages.push({
          level: "info",
          message: msg.message,
          ...json,
        });
      };

      const registerNotifyListener: OperationHookCallback = (
        input,
        _args,
        context,
        resolveInfo: GraphQLResolveInfoWithMessages
      ) => {
        if (!context || !context.pgClient) {
          // Not a PostGraphile dispatch (no client) - just return
          return input;
        }
        assert(
          !context.pgClient["processNotice"],
          "processNotice should not be set yet!"
        );
        context.pgClient["processNotice"] = makeProcessNotice(resolveInfo);
        context.pgClient.on("notice", context.pgClient["processNotice"]);
        return input;
      };

      const unregisterNotifyListener: OperationHookCallback = (
        input,
        _args,
        context,
        _resolveInfo: GraphQLResolveInfoWithMessages
      ) => {
        if (context.pgClient["processNotice"]) {
          context.pgClient.removeListener(
            "notice",
            context.pgClient["processNotice"]
          );
          delete context.pgClient["processNotice"];
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
