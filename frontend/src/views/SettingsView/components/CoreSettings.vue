<script setup lang="ts">
import { Branch } from '@/enums/app'
import { useModal } from '@/components/Modal'

import BranchDetail from './components/BranchDetail.vue'
import CoreConfiguration from './components/CoreConfig.vue'
import SwitchBranch from './components/SwitchBranch.vue'

const [ConfigModal, modalApi] = useModal({})

const branches = [Branch.Main, Branch.Alpha, Branch.Smart] as const

const handleCoreConfiguraion = async (branch: Branch) => {
  modalApi.setProps({ title: 'settings.kernel.config.name', minWidth: '70' })
  modalApi.setContent(CoreConfiguration, { branch }).open()
}
</script>

<template>
  <div>
    <BranchDetail
      v-for="branch in branches"
      :key="branch"
      :branch="branch"
      @config="handleCoreConfiguraion(branch)"
    />
    <SwitchBranch />
    <ConfigModal />
  </div>
</template>
