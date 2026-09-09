import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  webpack: (config) => {
    config.resolve.alias['@'] = fileURLToPath(new URL('./src', import.meta.url))
    return config
  },
  serverExternalPackages: [
    'axios',
    'https-proxy-agent',
    'follow-redirects',
  ],
}

export default nextConfig
