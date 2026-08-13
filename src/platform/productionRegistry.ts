import { AdapterRegistry } from "./adapterRegistry.js";
import { DouyinAdapter, type CaptureMedia } from "./douyin/douyinAdapter.js";
import { WechatOfficialAccountAdapter } from "./wechat/wechatOfficialAccountAdapter.js";
import type { CaptureWechatOptions } from "./wechat/wechatBrowserCapture.js";
import type { WechatPageSnapshot } from "./wechat/wechatTypes.js";

export interface ProductionRegistryOptions {
  projectRoot: string;
  douyinCapture?: CaptureMedia;
  wechatCapture?: (options: CaptureWechatOptions) => Promise<WechatPageSnapshot>;
}

export function createProductionAdapterRegistry(options: ProductionRegistryOptions): AdapterRegistry {
  return new AdapterRegistry([
    new DouyinAdapter({ captureMedia: options.douyinCapture, userDataDir: `${options.projectRoot}/.browser/douyin` }),
    new WechatOfficialAccountAdapter({ capture: options.wechatCapture, projectRoot: options.projectRoot }),
  ]);
}
