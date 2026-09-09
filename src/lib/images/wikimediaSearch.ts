import axios from 'axios'

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

export type WikimediaImageResult = {
  title: string
  url: string
  width: number
  height: number
  license: string | null
}

/**
 * Searches Wikimedia Commons (File namespace = 6) for a query and returns
 * the best candidate image, or null if nothing usable turned up. No API key
 * — public MediaWiki API, and Commons content is already free-use licensed
 * (resolves the copyright concern properly rather than just waiving it).
 */
export async function searchWikimediaImage(query: string): Promise<WikimediaImageResult | null> {
  const { data } = await axios.get(COMMONS_API, {
    params: {
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: 6,
      gsrlimit: 5,
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata',
      iiurlwidth: 800,
      format: 'json',
    },
    // Wikimedia's API etiquette policy rejects requests without a
    // descriptive User-Agent (403) — https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
    headers: { 'User-Agent': 'ProvaTri/1.0 (Colégio Harmonia; https://colegioharmonia.com.br) node-axios' },
    timeout: 10_000,
  })

  const pages = data?.query?.pages
  if (!pages) return null

  const candidates = Object.values(pages) as Array<{
    title: string
    imageinfo?: Array<{ thumburl?: string; url: string; width: number; height: number; extmetadata?: Record<string, { value?: string }> }>
  }>

  // Prefer reasonably sized images (skip tiny icons/logos) and actual raster
  // images (skip .svg/.pdf which don't embed cleanly via insertInlineImage
  // in every case, and skip .ogv/.webm media pages that occasionally match).
  const usable = candidates
    .map((c) => c.imageinfo?.[0] ? { title: c.title, info: c.imageinfo[0] } : null)
    .filter((c): c is { title: string; info: NonNullable<typeof c>['info'] } => Boolean(c))
    .filter((c) => c.info.width >= 300 && c.info.height >= 200)
    .filter((c) => /\.(jpg|jpeg|png)$/i.test(c.info.url))

  if (!usable.length) return null

  const best = usable[0]
  return {
    title: best.title,
    url: best.info.thumburl ?? best.info.url,
    width: best.info.width,
    height: best.info.height,
    license: best.info.extmetadata?.LicenseShortName?.value ?? null,
  }
}
