import type { DetailedHTMLProps, HTMLAttributes } from "react";

// <adsgram-task> — web component з AdsGram SDK (sad.min.js, app/layout.tsx).
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "adsgram-task": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
