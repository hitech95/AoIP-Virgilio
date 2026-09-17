/* Password (/system/password): change the root password. The daemon
 * verifies the current one and invalidates every session on success. */
<template>
  <el-form ref="pwform" label-width="auto" label-suffix=":" :model="pw" :rules="pwRules" style="max-width: 480px">
    <el-form-item :label="$t('Current password')" prop="old">
      <el-input type="password" v-model="pw.old" show-password/>
    </el-form-item>
    <el-form-item :label="$t('New password')" prop="new">
      <el-input type="password" v-model="pw.new" show-password/>
    </el-form-item>
    <el-form-item :label="$t('Repeat new password')" prop="repeat">
      <el-input type="password" v-model="pw.repeat" show-password/>
    </el-form-item>
  </el-form>

  <el-divider/>
  <div style="text-align: right; padding-right: 100px">
    <el-button type="primary" :loading="loading" @click="handlePassword">
      {{ $t('Change password') }}
    </el-button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      loading: false,
      pw: { old: '', new: '', repeat: '' },
      pwRules: {
        old: { required: true, trigger: 'blur', message: () => this.$t('This field is required') },
        new: {
          required: true, trigger: 'blur',
          validator: (_, value, callback) => {
            if (!value || value.length < 6)
              return callback(new Error(this.$t('At least 6 characters')))
            callback()
          }
        },
        repeat: {
          required: true, trigger: 'blur',
          validator: (_, value, callback) => {
            if (value !== this.pw.new)
              return callback(new Error(this.$t('Passwords do not match')))
            callback()
          }
        }
      }
    }
  },
  methods: {
    async handlePassword() {
      const valid = await this.$refs.pwform.validate().catch(() => false)
      if (!valid)
        return

      this.loading = true
      const r = await this.$oui.call('webui', 'set_password', {
        old: this.pw.old,
        new: this.pw.new
      })
      this.loading = false

      if (r?.error)
        return this.$message.error(r.error.message)

      this.$message.success(this.$t('Password changed, redirecting to login'))
      setTimeout(() => this.$router.push('/login'), 1500)
    }
  }
}
</script>

<i18n src="./locale.json"/>
