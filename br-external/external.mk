include $(BR2_EXTERNAL_VIRGILIO_PATH)/rustflags.mk
include $(sort $(wildcard $(BR2_EXTERNAL_VIRGILIO_PATH)/package/*/*.mk))
