import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  Download,
  HttpCancel,
  UnzipZIPFile,
  HttpGet,
  Exec,
  MoveFile,
  RemoveFile,
  AbsolutePath,
  BrowserOpenURL,
  MakeDir,
  UnzipGZFile,
  FileExists,
  ReadDir,
} from '@/bridge'
import { CoreWorkingDirectory } from '@/constant/kernel'
import { Branch } from '@/enums/app'
import { useAppSettingsStore, useEnvStore, useKernelApiStore } from '@/stores'
import {
  getGitHubApiAuthorization,
  GrantTUNPermission,
  ignoredError,
  confirm,
  message,
  debounce,
  getKernelFileName,
  getKernelAssetFileName,
} from '@/utils'

const StableUrl = 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest'
const AlphaUrl = 'https://api.github.com/repos/MetaCubeX/mihomo/releases/tags/Prerelease-Alpha'
const SmartUrl = 'https://api.github.com/repos/vernesong/mihomo/releases/tags/Prerelease-Alpha'

const StablePage = 'https://github.com/MetaCubeX/mihomo/releases/latest'
const AlphaPage = 'https://github.com/MetaCubeX/mihomo/releases/tag/Prerelease-Alpha'
const SmartPage = 'https://github.com/vernesong/mihomo/releases/tag/Prerelease-Alpha'

const VersionTxtUrl: Partial<Record<Branch, string>> = {
  [Branch.Alpha]:
    'https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt',
  [Branch.Smart]:
    'https://github.com/vernesong/mihomo/releases/download/Prerelease-Alpha/version.txt',
}

const ReleaseUrlMap: Record<Branch, string> = {
  [Branch.Main]: StableUrl,
  [Branch.Alpha]: AlphaUrl,
  [Branch.Smart]: SmartUrl,
}

const ReleasePageMap: Record<Branch, string> = {
  [Branch.Main]: StablePage,
  [Branch.Alpha]: AlphaPage,
  [Branch.Smart]: SmartPage,
}

const CacheDirectoryMap: Record<Branch, string> = {
  [Branch.Main]: 'stable',
  [Branch.Alpha]: 'alpha',
  [Branch.Smart]: 'smart',
}

const VersionMatcherMap: Record<Branch, RegExp> = {
  [Branch.Main]: /v\S+/,
  [Branch.Alpha]: /alpha-\S+/i,
  [Branch.Smart]: /smart-\S+/i,
}

export const useCoreBranch = (branch: Branch) => {
  const releaseUrl = ReleaseUrlMap[branch]

  const localVersion = ref('')
  const remoteVersion = ref('')
  const versionDetail = ref('')

  const localVersionLoading = ref(false)
  const remoteVersionLoading = ref(false)
  const downloading = ref(false)
  const downloadCompleted = ref(false)

  const rollbackable = ref(false)

  const { t } = useI18n()
  const envStore = useEnvStore()
  const appSettings = useAppSettingsStore()
  const kernelApiStore = useKernelApiStore()

  const restartable = computed(() => {
    const currentBranch = appSettings.app.kernel.branch
    if (!kernelApiStore.running) return false
    return localVersion.value && downloadCompleted.value && currentBranch === branch
  })

  const updatable = computed(
    () => remoteVersion.value && localVersion.value !== remoteVersion.value,
  )

  const grantable = computed(() => localVersion.value && envStore.env.os !== 'windows')

  const CoreFilePath = `${CoreWorkingDirectory}/${getKernelFileName(branch)}`
  const CoreBakFilePath = `${CoreFilePath}.bak`

  const downloadCore = async (cpuLevel?: 'v1' | 'v2' | 'v3') => {
    downloading.value = true
    try {
      const { body } = await HttpGet<Record<string, any>>(releaseUrl, {
        Authorization: getGitHubApiAuthorization(),
      })
      if (body.message) throw body.message

      const { assets, name } = body
      const assetVersion = branch === Branch.Main ? name : remoteVersion.value || name
      const assetName = getKernelAssetFileName(assetVersion, cpuLevel)
      const asset = assets.find((v: any) => v.name === assetName)
      if (!asset) throw 'Asset Not Found:' + assetName
      if (asset.uploader.type !== 'Bot') {
        await confirm('common.warning', 'settings.kernel.risk', {
          type: 'text',
          okText: 'settings.kernel.stillDownload',
        })
      }

      const downloadCacheFile = `data/.cache/${assetName}`

      const { update, destroy } = message.info('common.downloading', 10 * 60 * 1_000, () => {
        HttpCancel(downloadCacheFile)
        setTimeout(() => RemoveFile(downloadCacheFile), 1000)
      })

      await MakeDir(CoreWorkingDirectory)

      await Download(
        asset.browser_download_url,
        downloadCacheFile,
        undefined,
        (progress, total) => {
          update(t('common.downloading') + ((progress / total) * 100).toFixed(2) + '%')
        },
        { CancelId: downloadCacheFile },
      ).finally(destroy)

      await ignoredError(MoveFile, CoreFilePath, CoreBakFilePath)

      if (assetName.endsWith('.zip')) {
        const tmp = `data/.cache/${CacheDirectoryMap[branch]}`
        await UnzipZIPFile(downloadCacheFile, tmp)
        const name = (await ReadDir(tmp)).find((v) => v.name.startsWith('mihomo'))?.name
        if (!name) throw 'The Core file was not found in the compressed package'
        await MoveFile(`${tmp}/${name}`, CoreFilePath)
        await RemoveFile(tmp)
      } else {
        await UnzipGZFile(downloadCacheFile, CoreFilePath)
      }

      await RemoveFile(downloadCacheFile)

      if (!CoreFilePath.endsWith('.exe')) {
        await ignoredError(Exec, 'chmod', ['+x', await AbsolutePath(CoreFilePath)])
      }

      refreshLocalVersion()
      downloadCompleted.value = true
      message.success('common.success')
    } catch (error: any) {
      console.log(error)
      message.error(error.message || error)
      downloadCompleted.value = false
    }
    downloading.value = false
  }

  const getLocalVersion = async (showTips = false) => {
    localVersionLoading.value = true
    try {
      const res = await Exec(CoreFilePath, ['-v'])
      versionDetail.value = res.trim()
      const matcher = VersionMatcherMap[branch]
      return res.match(matcher)?.[0] || res.trim().split(/\s+/)[0] || ''
    } catch (error: any) {
      console.log(error)
      showTips && message.error(error)
    } finally {
      localVersionLoading.value = false
    }
    return ''
  }

  const getRemoteVersion = async (showTips = false) => {
    remoteVersionLoading.value = true
    try {
      if (VersionTxtUrl[branch]) {
        const { body } = await HttpGet(VersionTxtUrl[branch]!)
        return body.trim()
      }
      const { body } = await HttpGet<Record<string, any>>(releaseUrl, {
        Authorization: getGitHubApiAuthorization(),
      })
      if (body.message) throw body.message
      return body.name
    } catch (error: any) {
      console.log(error)
      showTips && message.error(error.message)
    } finally {
      remoteVersionLoading.value = false
    }
    return ''
  }

  const restartCore = async () => {
    if (!kernelApiStore.running) return
    try {
      await kernelApiStore.restartCore()
      downloadCompleted.value = false
      message.success('common.success')
    } catch (error: any) {
      message.error(error)
    }
  }

  const refreshLocalVersion = async (showTips = false) => {
    localVersion.value = await getLocalVersion(showTips)
  }

  const refreshRemoteVersion = async (showTips = false) => {
    remoteVersion.value = await getRemoteVersion(showTips)
  }

  const grantCorePermission = async () => {
    await GrantTUNPermission(CoreFilePath)
    message.success('common.success')
  }

  const rollbackCore = async () => {
    await confirm('common.warning', 'settings.kernel.rollback')

    const doRollback = () => MoveFile(CoreBakFilePath, CoreFilePath)

    const currentBranch = appSettings.app.kernel.branch
    const isCurrentRunning = kernelApiStore.running && currentBranch === branch
    if (isCurrentRunning) {
      await kernelApiStore.restartCore(doRollback)
    } else {
      await doRollback()
    }
    refreshLocalVersion()
    message.success('common.success')
  }

  const openReleasePage = () => {
    BrowserOpenURL(ReleasePageMap[branch])
  }

  const openFileLocation = async () => {
    const path = await AbsolutePath(CoreWorkingDirectory)
    BrowserOpenURL(path)
  }

  watch(
    () => appSettings.app.kernel.branch,
    () => (downloadCompleted.value = false),
  )

  watch(
    [localVersion, downloadCompleted],
    debounce(async () => {
      rollbackable.value = await FileExists(CoreBakFilePath)
    }, 500),
  )

  refreshLocalVersion()
  refreshRemoteVersion()

  return {
    restartable,
    updatable,
    grantable,
    rollbackable,
    versionDetail,
    localVersion,
    localVersionLoading,
    remoteVersion,
    remoteVersionLoading,
    downloading,
    refreshLocalVersion,
    refreshRemoteVersion,
    downloadCore,
    restartCore,
    rollbackCore,
    grantCorePermission,
    openReleasePage,
    openFileLocation,
  }
}
