declare module "screenshot-desktop" {
  interface ScreenshotOptions {
    format?: "png" | "jpg";
    screen?: number;
  }
  const screenshot: (options?: ScreenshotOptions) => Promise<Buffer>;
  export default screenshot;
}
