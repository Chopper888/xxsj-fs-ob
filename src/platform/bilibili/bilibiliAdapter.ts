import { PlatformAdapterError } from "../platformAdapter.js";
import type { PlatformAdapter,PlatformInput,PlatformRuntimeContext,NormalizedUrl } from "../platformAdapter.js";
import type { NormalizedContent,PlatformIdentity } from "../types.js";
import { acquireBilibili,acquireBilibiliMediaUrl,type BilibiliVideoData,type BilibiliSubtitle } from "./bilibiliApi.js";
import { materializeBilibiliMedia } from "./bilibiliMediaMaterializer.js";
import { buildBilibiliIdentity,isBilibiliVideoUrl,bilibiliRefFromContentId,resolveBilibiliShortLink,type BilibiliVideoRef } from "./bilibiliUrl.js";
type AcquireFn=(ref:BilibiliVideoRef,fetcher?:typeof fetch)=>Promise<{video:BilibiliVideoData;subtitle?:BilibiliSubtitle}>;
export class BilibiliAdapter implements PlatformAdapter {
  readonly platform="bilibili" as const;
  constructor(private readonly acquire:AcquireFn=acquireBilibili,private readonly resolveUrl:(url:string)=>Promise<string>=resolveBilibiliShortLink){}
  canHandle(i:PlatformInput){return isBilibiliVideoUrl(i.sourceUrl);}
  async normalizeUrl(i:PlatformInput,_c:PlatformRuntimeContext):Promise<NormalizedUrl>{const resolved=await this.resolveUrl(i.sourceUrl);const x=buildBilibiliIdentity(resolved);return {sourceUrl:i.sourceUrl,canonicalUrl:x.canonicalUrl,platformContentId:x.platformContentId,dedupeKey:i.dedupeKey};}
  async resolveIdentity(n:NormalizedUrl,_c:PlatformRuntimeContext):Promise<PlatformIdentity>{const x=buildBilibiliIdentity(n.canonicalUrl);return n.dedupeKey?{...x,sourceUrl:n.sourceUrl,dedupeKey:n.dedupeKey,dedupeAliases:[x.dedupeKey]}:{...x,sourceUrl:n.sourceUrl};}
  async resolveContent(identity:PlatformIdentity,_c:PlatformRuntimeContext):Promise<NormalizedContent>{const {video,subtitle}=await this.acquire(bilibiliRefFromContentId(identity.platformContentId));return {identity,contentType:"video",title:video.title,author:{id:String(video.owner.mid),name:video.owner.name,url:`https://space.bilibili.com/${video.owner.mid}`},publishedAt:new Date(video.pubdate*1000).toISOString(),texts:[...(subtitle?[{kind:"official_subtitle" as const,role:"primary" as const,text:subtitle.text,language:subtitle.lang}]:[]),...(video.desc?[{kind:"caption" as const,role:"context" as const,text:video.desc}]:[])],media:[{kind:"video",role:"primary",caption:video.title},{kind:"image",role:"context",sourceUrl:video.pic}],links:[{url:identity.canonicalUrl,role:"source"}],sourceMetadata:{durationSeconds:video.duration,cid:video.cid,bvid:video.bvid,acquisitionStrategy:"public-api-first",subtitleAvailable:Boolean(subtitle)}};}
  async materializeMedia(content:NormalizedContent,context:PlatformRuntimeContext){const cid=Number(content.sourceMetadata?.cid);if(!Number.isFinite(cid))throw new Error("bilibili_cid_missing");const media=await acquireBilibiliMediaUrl(bvidForDownload(content),cid);return[await materializeBilibiliMedia({taskDir:context.taskDir,mediaUrl:media.videoUrl,audioUrl:media.audioUrl,referer:content.identity.canonicalUrl})];}
}
function bvidForDownload(content: NormalizedContent): string {
  const sm = content.sourceMetadata?.bvid;
  if (typeof sm === "string" && /^BV[0-9A-Za-z]{10}$/i.test(sm)) return sm;
  const id = content.identity.platformContentId;
  if (/^BV[0-9A-Za-z]{10}$/i.test(id)) return id;
  throw new PlatformAdapterError("content_empty", "bilibili_missing_bvid");
}
