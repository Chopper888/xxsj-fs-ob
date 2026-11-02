export interface BrowserLaunchArgsOptions {
  headless: boolean;
  offscreen: boolean;
}

export function browserLaunchArgs(options: BrowserLaunchArgsOptions): string[] {
  const args = ["--disable-session-crashed-bubble"];
  if (!options.headless) {
    if (options.offscreen) {
      args.push("--window-position=-32000,-32000", "--window-size=900,700", "--start-minimized");
    } else {
      // Always force position/size in visible mode to override any off-screen coords
      // saved in the persistent profile from a previous offscreen run.
      args.push("--window-position=100,100", "--window-size=1280,800");
    }
  }
  return args;
}
