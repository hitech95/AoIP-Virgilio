<template>
  <el-card class="login">
    <template #header>
      <div class="header">{{ firstboot ? $t('Welcome') : $t('Login') }}</div>
    </template>

    <!-- first boot: root has no password yet -->
    <template v-if="firstboot">
      <el-alert type="warning" :closable="false" show-icon class="fb-hint"
                :title="$t('No administrator password is set. Choose one to secure this device.')"/>
      <el-form ref="fbform" label-width="auto" label-suffix=":" size="large" :model="fb" :rules="fbRules">
        <el-form-item :label="$t('New password')" prop="new">
          <el-input type="password" v-model="fb.new" show-password @keyup.enter="doFirstboot"/>
        </el-form-item>
        <el-form-item :label="$t('Repeat new password')" prop="repeat">
          <el-input type="password" v-model="fb.repeat" show-password @keyup.enter="doFirstboot"/>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" class="login-button" @click="doFirstboot">
            {{ $t('Set password and log in') }}
          </el-button>
        </el-form-item>
      </el-form>
    </template>

    <!-- normal login -->
    <template v-else>
      <el-form ref="form" label-width="80px" label-suffix=":" size="large" :model="formValue" :rules="rules">
        <el-form-item :label="$t('Username')" prop="username">
          <el-input v-model="formValue.username" prefix-icon="user"
                    :placeholder="$t('Please enter username')" @keyup.enter="login" autofocus/>
        </el-form-item>
        <el-form-item :label="$t('Password')" prop="password">
          <el-input type="password" v-model="formValue.password" prefix-icon="lock"
                    :placeholder="$t('Please enter password')" @keyup.enter="login" show-password/>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="login" class="login-button">
            {{ $t('Login') }}
          </el-button>
        </el-form-item>
      </el-form>
    </template>

    <el-divider/>
    <div class="copyright">
      <p>virgilio webui</p>
    </div>
  </el-card>
</template>

<script>
export default {
  data() {
    return {
      firstboot: false,
      loading: true,
      formValue: { username: 'root', password: '' },
      fb: { new: '', repeat: '' },
      rules: {
        username: {
          required: true, trigger: 'blur',
          message: () => this.$t('Please enter username')
        }
      },
      fbRules: {
        new: {
          required: true, trigger: 'blur',
          validator: (_, v, cb) => (!v || v.length < 6)
            ? cb(new Error(this.$t('At least 6 characters'))) : cb()
        },
        repeat: {
          required: true, trigger: 'blur',
          validator: (_, v, cb) => (v !== this.fb.new)
            ? cb(new Error(this.$t('Passwords do not match'))) : cb()
        }
      }
    }
  },
  async created() {
    try {
      const r = await this.$oui.call('webui', 'firstboot_status')
      this.firstboot = !!r?.firstboot
    } catch {
      this.firstboot = false
    }
    this.loading = false
  },
  methods: {
    async login() {
      const valid = await this.$refs.form.validate().catch(() => false)
      if (!valid)
        return

      this.loading = true
      try {
        await this.$oui.login(this.formValue.username, this.formValue.password)
        this.$router.push('/')
      } catch (e) {
        /* any login failure: re-check the firstboot state server-side
         * (-1001 = root password unset -> switch to the wizard) */
        let fb = false
        try {
          const r = await this.$oui.call('webui', 'firstboot_status')
          fb = !!r?.firstboot
        } catch {}
        if (String(e?.response?.data?.error?.code) === '-1001' || fb) {
          this.firstboot = true
        } else {
          this.$message.error(this.$t('wrong username or password'))
        }
      }
      this.loading = false
    },
    async doFirstboot() {
      const valid = await this.$refs.fbform.validate().catch(() => false)
      if (!valid)
        return

      this.loading = true
      const r = await this.$oui.call('webui', 'firstboot', { new: this.fb.new })
      if (r?.error) {
        this.loading = false
        return this.$message.error(r.error.message)
      }

      /* password set: log in with it right away */
      try {
        await this.$oui.login('root', this.fb.new)
        this.$router.push('/')
      } catch {
        this.$message.error(this.$t('Password set, please log in'))
        this.firstboot = false
      }
      this.loading = false
    }
  }
}
</script>

<style scoped>
.header { text-align: center; }
.login { width: 500px; top: 40%; left: 50%; position: fixed;
         transform: translate(-50%, -50%); }
.login-button { width: 100%; }
.fb-hint { margin-bottom: 16px; }
.copyright { text-align: right; font-size: 1.2em; color: #888; }
</style>

<i18n src="./locale.json"/>
