import OperationHooksPlugin from "./OperationHooksPlugin";
import { PostGraphilePlugin } from "postgraphile";
export { OperationHooksPlugin };
export * from "./OperationHooksPlugin";
declare module "postgraphile" {
    interface PostGraphileOptions {
        operationMessages?: boolean;
        operationMessagesPreflight?: boolean;
    }
}
declare const plugin: PostGraphilePlugin;
export default plugin;
