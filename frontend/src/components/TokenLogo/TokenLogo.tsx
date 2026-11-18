import { ReactNode, useState } from 'react'
import './TokenLogo.css'

interface TokenLogoProps {
  /** Metadata logo URL, if the token has one */
  image?: string
  /** Existing default content (e.g. 2-char label) shown when there is no usable image */
  fallback: ReactNode
}

/**
 * Renders a token's metadata logo inside an existing icon container,
 * falling back to the default content when there is no image or it fails to load.
 */
export default function TokenLogo({ image, fallback }: TokenLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!image || failedSrc === image) return <>{fallback}</>

  return (
    <img
      className="token-logo-img"
      src={image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(image)}
    />
  )
}
