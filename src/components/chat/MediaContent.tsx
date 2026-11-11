import { useState } from "react"
import { t } from "@/i18n/fr"
import type { MessageMedia } from "@/lib/mcp/types"

export function MediaContent({
  media,
  onImageClick,
}: { media: MessageMedia[]; onImageClick?: (img: { src: string; alt: string }) => void }) {
  if (media.length === 0) return null

  return (
    <div className="flex flex-col gap-2" data-testid="media-content">
      {media.map((item) => (
        <MediaItem key={item.id} item={item} onImageClick={onImageClick} />
      ))}
    </div>
  )
}

function MediaItem({
  item,
  onImageClick,
}: { item: MessageMedia; onImageClick?: (img: { src: string; alt: string }) => void }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const dataUrl = `data:${item.mimeType};base64,${item.base64}`

  const altText = item.type === "image"
    ? `${t.chat.mcpGeneratedImagePrefix} : ${item.toolLabel}`
    : `${t.chat.mcpAudioLabel} : ${item.toolLabel}`

  if (item.type === "image") {
    return (
      <div className="relative">
        {!error && loading && (
          <div
            data-testid={`media-skeleton-${item.id}`}
            className="w-full aspect-video bg-muted animate-pulse rounded"
            aria-hidden="true"
          />
        )}
        <img
          src={dataUrl}
          alt={altText}
          className={`
            max-w-full max-h-[70vh] w-auto h-auto rounded
            ${loading ? "invisible" : "visible"}
            ${error ? "hidden" : ""}
            ${onImageClick ? "cursor-zoom-in" : ""}
          `}
          style={{ maxWidth: "100%", maxHeight: "70vh", width: "auto", height: "auto" }}
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true) }}
          onClick={onImageClick ? () => onImageClick({ src: dataUrl, alt: altText }) : undefined}
        />
        {error && (
          <span role="note" className="text-sm text-muted-foreground">
            {t.chat.mcpUnrenderableMedia}
          </span>
        )}
      </div>
    )
  }

  // audio
  return (
    <div className="flex items-center gap-2">
      {!error && (
        <audio
          src={dataUrl}
          controls
          role="img"
          aria-label={altText}
          onError={() => setError(true)}
          className="w-full max-w-md"
        />
      )}
      {error && (
        <span role="note" className="text-sm text-muted-foreground">
          {t.chat.mcpUnrenderableMedia}
        </span>
      )}
    </div>
  )
}