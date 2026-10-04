import type { DesktopAPI } from "./shared/protocol";
declare global {
  interface Window {
    studio: DesktopAPI;
  }
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { src: string; partition?: string; allowpopups?: string };
    }
  }
}
export {};
