"use strict";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
const OperationHooksPlugin_1 = require("./OperationHooksPlugin");
exports.OperationHooksPlugin = OperationHooksPlugin_1.default;
__export(require("./OperationHooksPlugin"));
const plugin = {
    ["cli:flags:add:schema"](addFlag) {
        // Add some CLI flags. We're adding our plugin name in square brackets to
        // help the user know where the options are coming from.
        addFlag("--operation-messages", "[@graphile/operation-hooks] exposes messages generated during hooks via mutation payloads and error objects");
        addFlag("--operation-messages-preflight", "[@graphile/operation-hooks] adds a `preflight` boolean to mutations, when passed true the pre-mutation hooks will be called but the mutation will exit early; allowing you to see validation errors, etc, without actually running the mutation");
        // The ouput from one plugin is fed as the input into the next, so we must
        // remember to return the input.
        return addFlag;
    },
    // @ts-ignore See postgraphile#932
    ["cli:library:options"](options, { config, cliOptions }) {
        // Take the CLI options and add them as PostGraphile options.
        const { operationMessages = false, operationMessagesPreflight = false } = {
            ...config["options"],
            ...cliOptions,
        };
        return {
            ...options,
            operationMessages,
            operationMessagesPreflight,
        };
    },
    ["postgraphile:options"](options) {
        // This converts the `operationMessages` / `operationMessagesPreflight`
        // options from PostGraphile options into Graphile Engine (plugin) options.
        // (Necessary in case the user is using us as a library rather than CLI.)
        const { operationMessages, operationMessagesPreflight } = options;
        return {
            ...options,
            appendPlugins: [...(options.appendPlugins || []), OperationHooksPlugin_1.default],
            graphileBuildOptions: {
                ...options.graphileBuildOptions,
                operationMessages,
                operationMessagesPreflight,
            },
        };
    },
};
exports.default = plugin;
