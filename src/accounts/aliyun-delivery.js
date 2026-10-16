import Dypnsapi from '@alicloud/dypnsapi20170525';
import DirectMail from '@alicloud/dm20151123';
import OpenApi from '@alicloud/openapi-client';
import { fail } from './store.js';

const templates = { register: '100001', first_login: '100001', recover: '100003', contact: '100004' };
const subjects = {
  register: '后人纪注册验证码',
  first_login: '后人纪账号验证',
  recover: '后人纪找回密码验证码',
  contact: '后人纪联系方式验证码',
};

export class AliyunDelivery {
  constructor(cfg) {
    this.cfg = cfg;
    this.credentialsReady = !!(cfg.aliyunAccessKeyId && cfg.aliyunAccessKeySecret);
    this.emailReady = this.credentialsReady && !!cfg.aliyunMailFrom;
    this.phoneReady = this.credentialsReady && !!cfg.aliyunSmsSign;
  }
  config(endpoint, regionId) {
    return new OpenApi.Config({
      accessKeyId: this.cfg.aliyunAccessKeyId,
      accessKeySecret: this.cfg.aliyunAccessKeySecret,
      endpoint,
      ...(regionId ? { regionId } : {}),
    });
  }
  async sendEmail(address, code, purpose) {
    if (!this.emailReady) fail(503, 'verification_unavailable', '邮箱验证暂不可用，请稍后重试。');
    try {
      const client = new DirectMail.default(this.config('dm.aliyuncs.com', this.cfg.aliyunMailRegion));
      await client.singleSendMail(new DirectMail.SingleSendMailRequest({
        accountName: this.cfg.aliyunMailFrom,
        addressType: 1,
        replyToAddress: false,
        toAddress: address,
        subject: subjects[purpose],
        textBody: `验证码：${code}。5 分钟内有效，请勿告知他人。`,
      }));
    } catch {
      fail(503, 'verification_unavailable', '邮箱验证暂不可用，请稍后重试。');
    }
  }
  async sendSms(phone, purpose, challengeId) {
    if (!this.phoneReady) fail(503, 'verification_unavailable', '短信验证暂不可用，请稍后重试。');
    try {
      const client = new Dypnsapi.default(this.config('dypnsapi.aliyuncs.com'));
      const result = await client.sendSmsVerifyCode(new Dypnsapi.SendSmsVerifyCodeRequest({
        phoneNumber: phone.slice(3), countryCode: '86', signName: this.cfg.aliyunSmsSign,
        templateCode: templates[purpose], templateParam: JSON.stringify({ code: '##code##', min: '5' }),
        outId: challengeId, schemeName: 'houren-' + purpose,
        codeLength: 6, codeType: 1, validTime: 300, interval: 60, duplicatePolicy: 1, returnVerifyCode: false,
      }));
      if (result.body?.code !== 'OK' || result.body?.success !== true) throw new Error('sms rejected');
    } catch {
      fail(503, 'verification_unavailable', '短信验证暂不可用，请稍后重试。');
    }
  }
  async checkSms(phone, code, purpose, challengeId) {
    if (!this.phoneReady) fail(503, 'verification_unavailable', '短信验证暂不可用，请稍后重试。');
    try {
      const client = new Dypnsapi.default(this.config('dypnsapi.aliyuncs.com'));
      const result = await client.checkSmsVerifyCode(new Dypnsapi.CheckSmsVerifyCodeRequest({
        phoneNumber: phone.slice(3), countryCode: '86', verifyCode: code,
        outId: challengeId, schemeName: 'houren-' + purpose,
      }));
      return result.body?.code === 'OK' && result.body?.model?.verifyResult === 'PASS';
    } catch {
      fail(503, 'verification_unavailable', '短信验证暂不可用，请稍后重试。');
    }
  }
}
