import OperationHooksCorePlugin from "./OperationHooksCorePlugin";
import OperationMessagesPlugin from "./OperationMessagesPlugin";
import OperationMessagesMutationPayloadPlugin from "./OperationMessagesMutationPayloadPlugin";
import OperationMessagesMutationPreFlightPlugin from "./OperationMessagesMutationPreFlightPlugin";
import PgOperationHooksPlugin from "./PgOperationHooksPlugin";
import { makePluginByCombiningPlugins } from "graphile-utils";

// Export types
export * from "./OperationHooksCorePlugin";
export { GraphQLResolveInfoWithMessages } from "./OperationMessagesPlugin";

const OperationHooksPlugin = makePluginByCombiningPlugins(
  OperationHooksCorePlugin,
  OperationMessagesPlugin,
  PgOperationHooksPlugin,
  OperationMessagesMutationPayloadPlugin,
  OperationMessagesMutationPreFlightPlugin
);
OperationHooksPlugin.displayName = "OperationHooksPlugin";

export default OperationHooksPlugin;
