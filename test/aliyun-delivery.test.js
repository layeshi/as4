import test from 'node:test';
import assert from 'node:assert/strict';
import Dypnsapi from '@alicloud/dypnsapi20170525';
import DirectMail from '@alicloud/dm20151123';
import { AliyunDelivery } from '../src/accounts/aliyun-delivery.js';

const cfg = { aliyunAccessKeyId: 'test-id', aliyunAccessKeySecret: 'test-secret', aliyunMailFrom: 'auth@example.org', aliyunMailRegion: 'cn-hangzhou', aliyunSmsSign: 'system-sign' };

test('Aliyun SMS uses six digits, never returns the code, and checks the same challenge', async () => {
  const sms = Dypnsapi.default.prototype;
  const originalSend = sms.sendSmsVerifyCode, originalCheck = sms.checkSmsVerifyCode;
  const seen = [];
  sms.sendSmsVerifyCode = async request => { seen.push(request.toMap()); return { body: { code: 'OK', success: true } }; };
  sms.checkSmsVerifyCode = async request => { seen.push(request.toMap()); return { body: { code: 'OK', model: { verifyResult: 'PASS' } } }; };
  try {
    const delivery = new AliyunDelivery(cfg);
    await delivery.sendSms('+8613812345678', 'recover', 'challenge-id');
    assert.deepEqual({ codeLength: seen[0].CodeLength, codeType: seen[0].CodeType, returnCode: seen[0].ReturnVerifyCode, time: seen[0].ValidTime, interval: seen[0].Interval, template: seen[0].TemplateCode },
      { codeLength: 6, codeType: 1, returnCode: false, time: 300, interval: 60, template: '100003' });
    assert.equal(seen[0].PhoneNumber, '13812345678');
    assert.equal(seen[0].OutId, 'challenge-id');
    assert.equal(await delivery.checkSms('+8613812345678', '123456', 'recover', 'challenge-id'), true);
    assert.equal(seen[1].OutId, 'challenge-id');
    assert.equal(seen[1].VerifyCode, '123456');
  } finally { sms.sendSmsVerifyCode = originalSend; sms.checkSmsVerifyCode = originalCheck; }
});

test('Aliyun email sends a plain verification code and provider failures stay generic', async () => {
  const mail = DirectMail.default.prototype, original = mail.singleSendMail;
  let sent;
  mail.singleSendMail = async request => { sent = request.toMap(); };
  try {
    const delivery = new AliyunDelivery(cfg);
    await delivery.sendEmail('alice@example.org', '012345', 'register');
    assert.equal(sent.ToAddress, 'alice@example.org');
    assert.match(sent.TextBody, /012345/);
    assert.equal(sent.AccountName, 'auth@example.org');
    mail.singleSendMail = async () => { throw new Error('secret upstream detail'); };
    await assert.rejects(delivery.sendEmail('alice@example.org', '012345', 'register'), error => error.code === 'verification_unavailable' && !error.message.includes('secret'));
  } finally { mail.singleSendMail = original; }
});
