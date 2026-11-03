import { PlatformAdapterError } from "../platformAdapter.js";
import type { BilibiliVideoRef } from "./bilibiliUrl.js";
type Fetcher = typeof fetch;
export interface BilibiliVideoData { bvid:string; title:string; desc:string; pubdate:number; duration:number; pic:string; owner:{mid:number;name:string}; cid:number }
export interface BilibiliSubtitle { lang:string; text:string }
export interface BilibiliDashStreams { videoUrl:string; audioUrl:string; videoBytes?:number; audioBytes?:number; durationMs?:number }
async function json(fetcher:Fetcher,url:string,referer:string){ let response:Response; try { response=await fetcher(url,{headers:{"User-Agent":"Mozilla/5.0","Referer":referer},signal:AbortSignal.timeout(15000)}); } catch(e){ throw new PlatformAdapterError("temporary_network",String(e)); } if(response.status===429) throw new PlatformAdapterError("rate_limited"); if(!response.ok) throw new PlatformAdapterError("temporary_network",`HTTP ${response.status}`); return response.json() as Promise<any>; }
function apiError(code:number,message:string):never { if(code===-404) throw new PlatformAdapterError("not_found",message); if(code===-403||code===-101) throw new PlatformAdapterError("auth_required",message); if(code===-412) throw new PlatformAdapterError("verification_required",message); throw new PlatformAdapterError("content_unavailable",message); }
function refQuery(ref:BilibiliVideoRef):string { return ref.kind==="bv" ? `bvid=${encodeURIComponent(ref.bvid)}` : `aid=${ref.aid}`; }
function refReferer(ref:BilibiliVideoRef):string { return ref.kind==="bv" ? `https://www.bilibili.com/video/${ref.bvid}/` : `https://www.bilibili.com/video/av${ref.aid}/`; }
interface DashVideo { baseUrl?:unknown; size?:unknown; id?:unknown }
interface DashAudio { baseUrl?:unknown; size?:unknown; bandwidth?:unknown }
function selectDashVideo(videos:unknown[]):DashVideo|undefined {
  if(!Array.isArray(videos)||videos.length===0)return undefined;
  const list=videos as DashVideo[];
  const exact=list.find((v)=>v.id===64);
  if(exact)return exact;
  return list.reduce<DashVideo|undefined>((best,v)=>!v?best:best===undefined||Number(v.id??0)>Number(best.id??0)?v:best,undefined);
}
function selectDashAudio(audios:unknown[]):DashAudio|undefined {
  if(!Array.isArray(audios)||audios.length===0)return undefined;
  const list=audios as DashAudio[];
  return list.reduce<DashAudio|undefined>((best,v)=>!v?best:best===undefined||Number(v.bandwidth??0)>Number(best.bandwidth??0)?v:best,undefined);
}
export async function acquireBilibili(ref: BilibiliVideoRef, fetcher: Fetcher = fetch): Promise<{ video: BilibiliVideoData; subtitle?: BilibiliSubtitle }> {
  const referer = refReferer(ref), query = refQuery(ref);
  const view = await json(fetcher, `https://api.bilibili.com/x/web-interface/view?${query}`, referer);
  if (view.code !== 0) apiError(view.code, view.message);
  const video = view.data as BilibiliVideoData;
  if (!video?.title || !video.cid) throw new PlatformAdapterError("content_empty");
  if (ref.kind === "av" && !/^BV[0-9A-Za-z]{10}$/i.test(video.bvid ?? "")) throw new PlatformAdapterError("content_empty", `bilibili_missing_bvid aid=${ref.aid}`);
  const player = await json(fetcher, `https://api.bilibili.com/x/player/v2?${query}&cid=${video.cid}`, referer);
  if (player.code !== 0) apiError(player.code, player.message);
  const item = player.data?.subtitle?.subtitles?.[0];
  if (!item?.subtitle_url) return { video };
  const body = await json(fetcher, String(item.subtitle_url).replace(/^\/\//, "https://"), referer);
  const text = (body.body ?? []).map((x: any) => String(x.content ?? "").trim()).filter(Boolean).join("\n");
  return { video, ...(text ? { subtitle: { lang: String(item["lan"] ?? ""), text } } : {}) };
}
export async function acquireBilibiliMediaUrl(bvid: string, cid: number, fetcher: Fetcher = fetch): Promise<BilibiliDashStreams> {
  const referer = `https://www.bilibili.com/video/${encodeURIComponent(bvid)}/`;
  const body = await json(fetcher, `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=64&fnval=16`, referer);
  if (body.code !== 0) apiError(body.code, body.message);
  const video = selectDashVideo(body.data?.dash?.video), audio = selectDashAudio(body.data?.dash?.audio);
  if (!video?.baseUrl || !audio?.baseUrl) throw new PlatformAdapterError("media_unavailable");
  return { videoUrl: String(video.baseUrl), audioUrl: String(audio.baseUrl), videoBytes: Number(video.size) || undefined, audioBytes: Number(audio.size) || undefined, durationMs: Number(body.data?.dash?.duration) || undefined };
}
