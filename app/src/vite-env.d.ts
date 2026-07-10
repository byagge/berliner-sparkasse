/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MIRROR_ORIGIN?: string;
  readonly VITE_HOME_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
