"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const addMessagesToMeta = (_, _args, _context, resolveInfo) => {
    resolveInfo.graphileMeta.messages = [];
    return _;
};
const validateMessages = (_, _args, _context, resolveInfo) => {
    const firstError = resolveInfo.graphileMeta.messages.find(message => message.level === "error");
    if (firstError) {
        throw new Error(`Aborting ${resolveInfo.fieldName} due to error: ${firstError.message}`);
    }
    return _;
};
const addMessagesToError = (error, _args, _context, resolveInfo) => {
    error.extensions = error.extensions || {};
    error.extensions.messages = resolveInfo.graphileMeta.messages;
    return error;
};
const MutationMessagesPlugin = function MutationMessagesPlugin(builder) {
    builder.hook("init", (_, build) => {
        build.addOperationHook(() => {
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
exports.default = MutationMessagesPlugin;
