const args = process.argv.slice(2);
const numbers = args.map(arg => {
  if (isNaN(Number(arg))) {
    process.exit(1);
  }
  return Number(arg);
});

if (numbers.length === 0) {
  console.log(0);
  process.exit(0);
}

const sum = numbers.reduce((acc, num) => acc + num, 0);
console.log(sum);