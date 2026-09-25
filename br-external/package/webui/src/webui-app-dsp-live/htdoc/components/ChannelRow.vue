<template>
  <div v-if="channels.length" class="channel-row">
    <span class="channel-label">{{ label }}</span>
    <el-tag v-for="channel in channels" :key="channel" size="small" effect="plain" :class="`channel-${channel}`">{{ $t('Ch {n}', { n: channel }) }}</el-tag>
  </div>
</template>

<script>
export default {
  props: {
    label: String,
    channels: { type: Array, default: () => [] }
  }
}
</script>

<i18n src="../locale.json"/>
