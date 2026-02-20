type IconProps = {
  className?: string
}

export function BulbIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <path
        d="M32 8C21.5 8 13 16.5 13 27c0 6.5 3.3 12.2 8.3 15.6 1.4 1 2.2 2.6 2.2 4.3V48h17v-1.1c0-1.7.8-3.3 2.2-4.3 5-3.4 8.3-9.1 8.3-15.6C51 16.5 42.5 8 32 8Zm7.2 30.1c-2.6 1.8-4.2 4.6-4.5 7.9h-5.4c-.3-3.3-1.9-6.1-4.5-7.9-4.2-2.9-6.8-7.8-6.8-13.1C18 17.3 24.3 11 32 11s14 6.3 14 14c0 5.3-2.6 10.2-6.8 13.1Z"
        fill="currentColor"
      />
      <path d="M22.5 52a2 2 0 0 1 2-2h15a2 2 0 1 1 0 4h-15a2 2 0 0 1-2-2Z" fill="currentColor" />
      <path d="M25.5 58a2 2 0 0 1 2-2h9a2 2 0 1 1 0 4h-9a2 2 0 0 1-2-2Z" fill="currentColor" />
      <path
        d="M32 25.5a7.5 7.5 0 0 0-7.5 7.5 2 2 0 1 0 4 0 3.5 3.5 0 0 1 7 0 2 2 0 1 0 4 0 7.5 7.5 0 0 0-7.5-7.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function MailIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11Zm2 0v.2L12 11.3l7-4.6v-.2a.5.5 0 0 0-.5-.5h-13a.5.5 0 0 0-.5.5Zm14 2.6-6.5 4.2a1 1 0 0 1-1 0L5 9.1v8.4a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V9.1Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 2a5 5 0 0 0-5 5v2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 7V7a3 3 0 1 1 6 0v2H9Zm3 3a2 2 0 0 1 1 3.7V18a1 1 0 1 1-2 0v-2.3A2 2 0 0 1 12 12Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 5c4.8 0 8.9 2.8 10.7 6.9a1 1 0 0 1 0 .8C20.9 16.8 16.8 19.6 12 19.6S3.1 16.8 1.3 12.7a1 1 0 0 1 0-.8C3.1 7.8 7.2 5 12 5Zm0 2C8.2 7 4.9 9.1 3.3 12c1.6 2.9 4.9 5 8.7 5s7.1-2.1 8.7-5C19.1 9.1 15.8 7 12 7Zm0 1.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Zm0 2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function UserCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.2a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6Zm0 13.8a7 7 0 0 1-5.5-2.7 5.9 5.9 0 0 1 11 0A7 7 0 0 1 12 19Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function WifiIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path
        d="M16 25.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Zm0-5.6c-2.5 0-4.8 1-6.5 2.8a1.4 1.4 0 1 0 2 2 6.3 6.3 0 0 1 9 0 1.4 1.4 0 1 0 2-2 9.1 9.1 0 0 0-6.5-2.8Zm0-6.7a15.7 15.7 0 0 0-11.2 4.7 1.4 1.4 0 0 0 2 2 12.9 12.9 0 0 1 18.4 0 1.4 1.4 0 0 0 2-2A15.7 15.7 0 0 0 16 12.9Z"
        fill="currentColor"
      />
    </svg>
  )
}
