// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export const visualRenderLimit={width:1920,height:1080} as const;
/** Preserve aspect ratio within a 1080p budget, including fullscreen and high-DPI. */
export function visualResolution(width:number,height:number,dpr:number,quality=1,maxDimension=8192){
 const w=Math.max(1,width),h=Math.max(1,height);
 const density=Math.max(1,Math.min(2,dpr));
 const requested=density;
 // A shared scale keeps the scene's aspect ratio, including ultrawide/fullscreen.
 const longest=Math.max(w,h),shortest=Math.min(w,h);
 const scale=Math.min(requested,maxDimension/w,maxDimension/h,visualRenderLimit.width/longest,visualRenderLimit.height/shortest)*Math.max(.5,Math.min(1,quality));
 return {width:Math.max(1,Math.round(w*scale)),height:Math.max(1,Math.round(h*scale))};
}
