type ShangwangLogoProps = {
  class?: string
}

export function ShangwangLogo(props: ShangwangLogoProps) {
  return (
    <div
      class={`flex shrink-0 select-none items-center gap-2 ${props.class ?? ""}`}
      aria-label="尚网"
      data-slot="shangwang-logo"
    >
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" class="shrink-0">
        <rect width="22" height="22" rx="6" fill="url(#shangwang-logo-gradient)" />
        <circle cx="7" cy="11" r="2" fill="white" fill-opacity="0.95" />
        <circle cx="15" cy="7" r="2" fill="white" fill-opacity="0.95" />
        <circle cx="15" cy="15" r="2" fill="white" fill-opacity="0.95" />
        <path
          d="M8.6 10.2L13.4 8M8.6 11.8L13.4 14"
          stroke="white"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-opacity="0.9"
        />
        <defs>
          <linearGradient id="shangwang-logo-gradient" x1="2" y1="2" x2="20" y2="20" gradientUnits="userSpaceOnUse">
            <stop stop-color="#3B82F6" />
            <stop offset="1" stop-color="#1D4ED8" />
          </linearGradient>
        </defs>
      </svg>
      <span class="text-[14px] font-semibold tracking-[0.04em] text-v2-text-text-base [font-weight:600]">尚网</span>
    </div>
  )
}
