// Evaluates duplicate-question clustering on a small labeled pair set (precision / recall per threshold).
import { lexVec, cosine } from '../client/src/core/cluster.js';
const dup = [
  ['When is the assignment deadline?', 'what is the deadline for the assignment'],
  ['Can you explain recursion again?', 'Please explain recursion once more'],
  ['Will the slides be shared after class?', 'Can you share the slides after the lecture'],
  ['Is attendance mandatory for the lab?', 'Do we have to attend the lab sessions'],
  ['How is the final grade calculated?', 'How will final grades be calculated'],
  ['What is the difference between a stack and a queue?', 'stack vs queue difference?'],
  ['Where do we submit the project report?', 'Where should the project report be submitted'],
  ['Will the exam cover chapter 5?', 'Is chapter 5 included in the exam'],
  ['Can we use calculators in the test?', 'Are calculators allowed during the test'],
  ['What time does the hackathon start?', 'When does the hackathon begin'],
  ['Is lunch provided at the fest?', 'Will lunch be provided at the fest'],
  ['How do I join the Wi-Fi network?', 'how to connect to the wifi network'],
];
const non = [
  ['When is the assignment deadline?', 'Is attendance mandatory for the lab?'],
  ['Can you explain recursion again?', 'Where do we submit the project report?'],
  ['Will the slides be shared after class?', 'What time does the hackathon start?'],
  ['How is the final grade calculated?', 'Can we use calculators in the test?'],
  ['What is the difference between a stack and a queue?', 'Is lunch provided at the fest?'],
  ['Will the exam cover chapter 5?', 'How do I join the Wi-Fi network?'],
  ['Where do we submit the project report?', 'How is the final grade calculated?'],
  ['What time does the hackathon start?', 'Will the exam cover chapter 5?'],
  ['Can we use calculators in the test?', 'Can you explain recursion again?'],
  ['Is lunch provided at the fest?', 'When is the assignment deadline?'],
  ['How do I join the Wi-Fi network?', 'What is the difference between a stack and a queue?'],
  ['Is attendance mandatory for the lab?', 'Will the slides be shared after class?'],
];
console.log('Lexical (offline) embedding - labeled pairs:', dup.length, 'duplicates,', non.length, 'non-duplicates');
const sim = ([a, b]) => cosine(lexVec(a), lexVec(b));
console.table([0.3, 0.4, 0.5, 0.6, 0.7].map((t) => {
  const tp = dup.filter((p) => sim(p) >= t).length, fn = dup.length - tp, fp = non.filter((p) => sim(p) >= t).length;
  const precision = tp + fp ? tp / (tp + fp) : 1, recall = tp / (tp + fn);
  return { threshold: t, precision: precision.toFixed(2), recall: recall.toFixed(2), f1: (2 * precision * recall / (precision + recall || 1)).toFixed(2), TP: tp, FP: fp, FN: fn };
}));
console.log('Note: tiny hand-labeled set - extend it with real questions from your own classes before quoting numbers.');
