export type DeployMode = "subdomain" | "domain"

export type DeployPreviewRequest = {
  projectRoot: string
  mode: DeployMode
  target: string
  protocol?: "http" | "https"
  cdnHttps?: boolean
  certId?: string
}

export type DeployStartRequest = DeployPreviewRequest & {
  noClean?: boolean
}

export type DeployVerifyRequest = {
  sessionId: string
  action: "verify" | "refresh" | "cancel"
}

export type SseEvent =
  | { type: "step-start"; step: number; total: number; name: string }
  | { type: "step-complete"; step: number; total: number; name: string; message: string }
  | { type: "status"; message: string }
  | {
      type: "cdn-verification"
      sessionId: string
      record: {
        domain: string
        rootDomain: string
        host: string
        recordType: string
        value: string
        fqdn: string
      }
    }
  | {
      type: "complete"
      result: {
        url: string
        urls: string[]
        cosPath: string
        cdnEntries: Array<{ domain: string; cname: string; created: boolean }>
      }
    }
  | { type: "error"; message: string; record?: SseEvent extends { type: "cdn-verification" } ? never : unknown }
