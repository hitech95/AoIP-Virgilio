<template>
  <el-form ref="form" size="large" label-width="auto" label-suffix=":" :model="formValue" :rules="rules" style="max-width: 560px">
    <el-form-item :label="$t('Hostname')" prop="hostname">
      <el-input v-model="formValue.hostname"/>
    </el-form-item>
    <el-form-item :label="$t('Timezone')" prop="zonename">
      <el-select v-model="formValue.zonename" filterable>
        <el-option v-for="item in zoneinfo" :key="item[0]" :label="item[0]" :value="item[0]"/>
      </el-select>
    </el-form-item>
  </el-form>

  <el-divider/>
  <div style="text-align: right; padding-right: 100px">
    <el-button type="primary" :loading="loading" @click="handleSubmit">{{ $t('Save & Apply') }}</el-button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      loading: false,
      zoneinfo: [['UTC', 'UTC']],   /* replaced by system.get_timezones */
      formValue: {
        hostname: this.$oui.state.hostname,
        zonename: ''
      },
      rules: {
        hostname: {
          required: true,
          trigger: 'blur',
          validator: (_, value, callback) => {
            if (!value)
              return callback(new Error(this.$t('This field is required')))
            if (value.length <= 253 && (value.match(/^[a-zA-Z0-9_]+$/) || (value.match(/^[a-zA-Z0-9_][a-zA-Z0-9_\-.]*[a-zA-Z0-9]$/) && value.match(/[^0-9.]/))))
              return callback()
            return callback(new Error(this.$t('Invalid hostname')))
          }
        }
      }
    }
  },
  created() {
    /* zone table from the device (LuCI model: data file + RPC) */
    this.$oui.call('system', 'get_timezones').then(({ timezones }) => {
      if (Array.isArray(timezones) && timezones.length)
        this.zoneinfo = timezones
    })

    this.$oui.call('uci', 'get', {
      config: 'system',
      section: '@system[0]',
      option: 'zonename'
    }).then(zonename => {
      this.formValue.zonename = zonename || 'UTC'
    })
  },
  methods: {
    async handleSubmit() {
      const valid = await this.$refs.form.validate().catch(() => false)
      if (!valid)
        return

      this.loading = true

      try {
        await this.$oui.call('uci', 'set', {
          config: 'system',
          section: '@system[0]',
          values: {
            hostname: this.formValue.hostname,
            timezone: zoneinfo.filter(item => item[0] === this.formValue.zonename)[0][1],
            zonename: this.formValue.zonename === 'UTC' ? '' : this.formValue.zonename
          }
        })

        /* procd reload trigger on 'system' re-applies hostname + TZ */
        await this.$oui.reloadConfig('system')

        this.$message.success(this.$t('Configuration has been applied'))
      } catch {
        this.$message.error(this.$t('Failed to apply'))
      }

      this.loading = false
    }
  }
}
</script>

<i18n src="./locale.json"/>
