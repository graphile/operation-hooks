import { Plugin } from "graphile-build";
import { GraphQLResolveInfoWithMeta } from "./OperationHooksPlugin";
interface Message {
    level: string;
    message: string;
    path?: string[];
}
export interface GraphQLResolveInfoWithMessages extends GraphQLResolveInfoWithMeta {
    graphileMeta: {
        messages: Message[];
    };
}
declare const MutationMessagesPlugin: Plugin;
export default MutationMessagesPlugin;
