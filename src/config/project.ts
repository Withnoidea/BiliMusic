// Runtime links shared by the main process and renderer. Keep build.publish in sync.
export const GITHUB_OWNER = 'Withnoidea'
export const GITHUB_REPO = 'BiliMusic'
export const PROJECT_REPOSITORY = `${GITHUB_OWNER}/${GITHUB_REPO}`
export const PROJECT_URL = `https://github.com/${PROJECT_REPOSITORY}`
export const RELEASES_URL = `${PROJECT_URL}/releases`
export const LATEST_RELEASE_API = `https://api.github.com/repos/${PROJECT_REPOSITORY}/releases/latest`
export const RELEASE_DOWNLOAD_BASE = `${RELEASES_URL}/latest/download`
