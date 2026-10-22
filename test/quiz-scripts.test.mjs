import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { QUIZ_PAPER } from '../server/worker/lib/quiz-scripts.mjs';

let br;
let pg;
before(async () => {
  br = await chromium.launch({ headless: true, channel: 'chrome' });
  pg = await br.newPage();
});
after(async () => {
  await br.close();
});

/** 真实结构的试卷：两道题（第一题已选 B，第二题未选），含答题卡 */
const PAPER = `
<div class="examPaper_subject mt20">
  <div class="subject_stem clearfix">
    <div class="subject_num fl"><span id="anchor_1">1.</span></div>
    <span class="subject_type"><span>【单选题】</span> <span>(2分)</span></span>
    <div class="subject_describe dynamic-fonts"></div>
  </div>
  <div class="subject_node">
    <div class="nodeLab nodeLab12"><div class="label clearfix">
      <div class="fl ffff"><input type="radio" class="mr30" value="111" style="display:none"><img class="flagChecked" src="/unchecked.png"></div>
      <span class="mr10 ABCase">A.</span>
      <div class="node_detail examquestions-answer fl dynamic-fonts"><p>说法甲</p></div>
    </div></div>
    <div class="nodeLab nodeLab12"><div class="label clearfix">
      <div class="fl ffff"><input type="radio" class="mr30" value="222" style="display:none"><img class="flagChecked" src="/checked.png"></div>
      <span class="mr10 ABCase onChecked">B.</span>
      <div class="node_detail examquestions-answer fl onChecked dynamic-fonts"><p>说法乙</p></div>
    </div></div>
    <div class="nodeLab nodeLab12"><div class="label clearfix">
      <div class="fl ffff"><input type="radio" class="mr30" value="333" style="display:none"><img class="flagChecked" src="/unchecked.png"></div>
      <span class="mr10 ABCase">C.</span>
      <div class="node_detail examquestions-answer fl dynamic-fonts"><p>说法丙</p></div>
    </div></div>
  </div>
</div>
<div class="examPaper_subject mt20" style="display:none">
  <div class="subject_stem clearfix">
    <div class="subject_num fl"><span id="anchor_2">2.</span></div>
    <span class="subject_type"><span>【多选题】</span> <span>(2分)</span></span>
    <div class="subject_describe dynamic-fonts"><p>下面哪些是心理健康的表现？</p></div>
  </div>
  <div class="subject_node">
    <div class="nodeLab nodeLab12"><div class="label clearfix">
      <div class="fl ffff"><input type="checkbox" class="mr30" value="444" style="display:none"><img class="flagChecked" src="/unchecked.png"></div>
      <span class="mr10 ABCase">A.</span>
      <div class="node_detail examquestions-answer fl dynamic-fonts"><p>情绪稳定</p></div>
    </div></div>
    <div class="nodeLab nodeLab12"><div class="label clearfix">
      <div class="fl ffff"><input type="checkbox" class="mr30" value="555" style="display:none"><img class="flagChecked" src="/unchecked.png"></div>
      <span class="mr10 ABCase">B.</span>
      <div class="node_detail examquestions-answer fl dynamic-fonts"><p>适应环境</p></div>
    </div></div>
  </div>
</div>
<ul class="answerCard_list1"><li class="green">1</li><li class="white">2</li></ul>
<div class="switch-btn-box"><button>上一题</button><button>下一题</button></div>
<div class="operateBtn_box"><button>提交作业</button><button>暂存作业</button></div>
`;

test('QUIZ_PAPER 读得出题目/选项/题型/题干', async () => {
  await pg.setContent('<!doctype html><html><body>' + PAPER + '</body></html>');
  const p = await pg.evaluate(QUIZ_PAPER);
  assert.equal(p.questions.length, 2);
  const q1 = p.questions[0];
  assert.equal(q1.num, 1);
  assert.match(q1.type, /单选题/);
  assert.equal(q1.options.length, 3);
  assert.equal(q1.options[0].label, 'A');
  assert.equal(q1.options[0].text, '说法甲');
  assert.equal(q1.visible, true);
  assert.equal(p.questions[1].visible, false);
  assert.match(p.questions[1].stem, /心理健康的表现/);
});

test('QUIZ_PAPER 认得 onChecked 选中态（智慧树不用原生 checked）', async () => {
  await pg.setContent('<!doctype html><html><body>' + PAPER + '</body></html>');
  const p = await pg.evaluate(QUIZ_PAPER);
  const opts = p.questions[0].options;
  assert.deepEqual(
    opts.map((o) => o.checked),
    [false, true, false],
    JSON.stringify(opts.map((o) => o.checked))
  );
  assert.equal(
    p.questions[1].options.every((o) => !o.checked),
    true
  );
});

test('QUIZ_PAPER 认得出「已经交过」的查看页（有得分、没有提交作业）', async () => {
  // 平台对已交的卷子打开的是查看页：URL 里是 checkHomework，正文有「得 分:」和「本题的得分」，
  // 没有「提交作业 / 下一题」。这种页面不能重答，必须判成 review。
  const REVIEW = `
  <div class="examPaper_subject mt20">
    <div class="subject_stem clearfix">
      <div class="subject_num fl"><span>1.</span></div>
      <span class="subject_type"><span>【单选题】</span> <span>(2分)</span></span>
      <div class="subject_describe dynamic-fonts"><p>题干</p></div>
    </div>
    <div class="subject_node">
      <div class="nodeLab nodeLab12"><div class="label clearfix">
        <div class="fl ffff"><input type="radio" value="111" style="display:none"></div>
        <span class="mr10 ABCase onChecked">A.</span>
        <div class="node_detail examquestions-answer fl onChecked dynamic-fonts"><p>选项甲</p></div>
      </div></div>
    </div>
    <div class="subject_score"><span>本题的得分</span><span>2</span></div>
  </div>
  <div class="paper_result"><span>得 分:</span><span>16</span><span>评 语:</span></div>
  `;
  await pg.setContent('<!doctype html><html><body>' + REVIEW + '</body></html>');
  const p = await pg.evaluate(QUIZ_PAPER);
  assert.equal(p.review, true, JSON.stringify({ hasSubmit: p.hasSubmit, graded: p.graded, url: p.url }));
  assert.equal(p.hasSubmit, false);
  assert.equal(p.graded, true);
});

test('QUIZ_PAPER：正常试卷不算 review', async () => {
  await pg.setContent('<!doctype html><html><body>' + PAPER + '</body></html>');
  const p = await pg.evaluate(QUIZ_PAPER);
  assert.equal(p.review, false);
  assert.equal(p.hasSubmit, true);
});

test('QUIZ_PAPER 读得出答题卡与按钮', async () => {
  await pg.setContent('<!doctype html><html><body>' + PAPER + '</body></html>');
  const p = await pg.evaluate(QUIZ_PAPER);
  assert.deepEqual(
    p.card.map((c) => c.done),
    [true, false]
  );
  assert.ok(p.buttons.includes('下一题'));
  assert.ok(p.buttons.includes('提交作业'));
});
