/*
 * Maintenance (/system/maintenance): reboot, factory reset (restores the
 * packaged /etc/config defaults, optionally wiping /opt/user_data) and
 * the firmware-upgrade placeholder (needs the production UBI image
 * layout, plan/squashfs-overlay-userdata.md). UI patterns recycled from
 * OUI's oui-app-upgrade confirm dialogs.
 */
<template>
  <div class="maint-page">
    <el-card shadow="never" class="maint-card">
      <template #header>{{ $t('Reboot') }}</template>
      <p class="hint">{{ $t('Reboots the speaker.') }}</p>
      <el-button type="danger" @click="handleReboot">{{ $t('Reboot') }}</el-button>
    </el-card>

    <el-card shadow="never" class="maint-card">
      <template #header>{{ $t('Factory reset') }}</template>
      <p class="hint">{{ $t('Restores the shipped configuration (hostname, network, DSP). All settings are lost.') }}</p>
      <el-checkbox v-model="wipeUserdata">{{ $t('Also delete user files (FIR coefficients)') }}</el-checkbox>
      <div style="margin-top: 12px">
        <el-button type="danger" @click="handleFactoryReset">{{ $t('Factory reset') }}</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="maint-card">
      <template #header>{{ $t('Firmware upgrade') }}</template>
      <p class="hint">{{ $t('Not available on this build: requires the production UBI image layout (see plan/squashfs-overlay-userdata.md).') }}</p>
      <el-button disabled>{{ $t('Firmware upgrade') }}</el-button>
    </el-card>
  </div>
</template>

<script>
export default {
  data() {
    return {
      wipeUserdata: false
    }
  },
  methods: {
    handleReboot() {
      this.$confirm(this.$t('Really reboot the device?'))
        .then(() => this.$oui.ubus('system', 'reboot'))
        .catch(() => {})
    },
    handleFactoryReset() {
      this.$confirm(this.$t('Really reset everything to factory defaults? The device reboots automatically.'), {
        type: 'warning',
        confirmButtonText: this.$t('Factory reset'),
        cancelButtonText: this.$t('Cancel')
      })
        .then(() => {
          return this.$oui.call('webui', 'factory_reset', {
            wipe_user_data: this.wipeUserdata
          })
        })
        .then(r => {
          if (r?.error)
            this.$message.error(r.error.message)
          else
            this.$message.success(this.$t('Resetting, the device reboots now'))
        })
        .catch(() => {})
    }
  }
}
</script>

<style scoped>
.maint-page { padding: 0 10px; display: flex; gap: 20px; align-items: stretch; flex-wrap: wrap; }
.maint-card { flex: 1 1 300px; min-width: 300px; display: flex; flex-direction: column; }
.maint-card :deep(.el-card__body) { flex: 1; }
.hint { color: #888; font-size: 13px; }
</style>

<i18n src="../locale.json"/>
