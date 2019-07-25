"use strict";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
const OperationHooksCorePlugin_1 = require("./OperationHooksCorePlugin");
const OperationMessagesPlugin_1 = require("./OperationMessagesPlugin");
const OperationMessagesMutationPayloadPlugin_1 = require("./OperationMessagesMutationPayloadPlugin");
const OperationMessagesMutationPreFlightPlugin_1 = require("./OperationMessagesMutationPreFlightPlugin");
const PgOperationHooksPlugin_1 = require("./PgOperationHooksPlugin");
const graphile_utils_1 = require("graphile-utils");
// Export types
__export(require("./OperationHooksCorePlugin"));
const OperationHooksPlugin = graphile_utils_1.makePluginByCombiningPlugins(OperationHooksCorePlugin_1.default, OperationMessagesPlugin_1.default, PgOperationHooksPlugin_1.default, OperationMessagesMutationPayloadPlugin_1.default, OperationMessagesMutationPreFlightPlugin_1.default);
OperationHooksPlugin.displayName = "OperationHooksPlugin";
exports.default = OperationHooksPlugin;
