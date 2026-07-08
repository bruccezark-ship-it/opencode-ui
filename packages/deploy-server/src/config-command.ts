import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import {
  createDefaultGlobalConfig,
  getGlobalConfigPath,
  globalConfigSchema,
  saveGlobalConfig,
  type GlobalConfig,
} from "@opencode-ai/deploy-core"

async function ask(
  rl: ReturnType<typeof createInterface>,
  label: string,
  options?: { defaultValue?: string; required?: boolean },
) {
  const suffix = options?.defaultValue ? ` [${options.defaultValue}]` : ""
  const answer = (await rl.question(`${label}${suffix}: `)).trim()
  if (answer) return answer
  if (options?.defaultValue !== undefined) return options.defaultValue
  if (options?.required) throw new Error(`${label} 不能为空`)
  return ""
}

export function buildConfigTemplate(): GlobalConfig {
  return createDefaultGlobalConfig()
}

export async function runConfigCommand(flags: Record<string, string | boolean>) {
  const configPath = getGlobalConfigPath()

  if (flags.init === true) {
    const template = buildConfigTemplate()
    process.stdout.write(`${JSON.stringify(template, null, 2)}\n`)
    process.stdout.write(`\n# 保存路径: ${configPath}\n`)
    return
  }

  const rl = createInterface({ input, output })
  const defaults = createDefaultGlobalConfig()

  try {
    process.stdout.write("\nOpenCode Deploy 全局配置\n")
    process.stdout.write(`配置文件: ${configPath}\n\n`)

    const secretId = await ask(rl, "腾讯云 SecretId", { required: true })
    const secretKey = await ask(rl, "腾讯云 SecretKey", { required: true })
    const region = await ask(rl, "COS 地域 (如 ap-guangzhou)", { defaultValue: defaults.tencent.region })
    const bucket = await ask(rl, "COS 存储桶名称", { required: true })
    const baseDomain = await ask(rl, "主域名", { required: true })
    const prefix = await ask(rl, "COS 路径前缀", { defaultValue: defaults.cos.prefix })
    const protocolInput = await ask(rl, "默认访问协议 (http/https)", {
      defaultValue: defaults.domain.protocol,
    })
    const protocol = protocolInput === "https" ? "https" : "http"
    const cdnHttpsInput = await ask(rl, "是否开启 CDN HTTPS? (y/N)", { defaultValue: "n" })
    const cdnHttps = cdnHttpsInput.toLowerCase() === "y" || cdnHttpsInput.toLowerCase() === "yes"

    let certId: string | undefined
    if (cdnHttps) {
      certId = await ask(rl, "CDN HTTPS 证书 ID", { required: true })
    }

    const mainlandRegions = ["ap-guangzhou", "ap-shanghai", "ap-beijing", "ap-nanjing", "ap-chengdu", "ap-chongqing"]
    const defaultArea = mainlandRegions.includes(region) ? "mainland" : "overseas"
    const areaInput = await ask(rl, "CDN 加速区域 (mainland/overseas/global)", { defaultValue: defaultArea })
    const area = ["mainland", "overseas", "global"].includes(areaInput) ? areaInput : defaultArea

    const config: GlobalConfig = {
      tencent: { secretId, secretKey, region },
      cos: { bucket, prefix },
      cdn: {
        serviceType: "web",
        area: area as GlobalConfig["cdn"]["area"],
        https: cdnHttps,
        certId,
        defaultCacheRules: defaults.cdn.defaultCacheRules,
      },
      dns: { domain: baseDomain, recordLine: "默认", ttl: 600 },
      domain: { baseDomain, protocol },
    }

    const parsed = globalConfigSchema.parse(config)
    const confirmSave = await ask(rl, "保存配置? (Y/n)", { defaultValue: "y" })
    if (confirmSave.toLowerCase() === "n" || confirmSave.toLowerCase() === "no") {
      process.stdout.write("已取消\n")
      return
    }

    await saveGlobalConfig(parsed)
    process.stdout.write(`\n配置已保存至 ${configPath}\n`)
  } finally {
    rl.close()
  }
}
