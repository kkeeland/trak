import { getConfigValue, setConfigValue, loadConfig } from '../db.js';
import { c } from '../utils.js';

export function configGetCommand(key: string): void {
  const value = getConfigValue(key);
  if (value === undefined) {
    console.log(`${c.dim}(not set)${c.reset}`);
  } else {
    console.log(`${c.bold}${key}${c.reset} = ${JSON.stringify(value)}`);
  }
}

export function configSetCommand(key: string, value: string): void {
  // Parse value
  let parsed: any;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (value === 'null') parsed = null;
  else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
  else if (/^\d+\.\d+$/.test(value)) parsed = parseFloat(value);
  else parsed = value;

  setConfigValue(key, parsed);
  console.log(`${c.green}✓${c.reset} ${c.bold}${key}${c.reset} = ${JSON.stringify(parsed)}`);
}

export function configListCommand(): void {
  const config = loadConfig();
  if (Object.keys(config).length === 0) {
    console.log(`${c.dim}No configuration set${c.reset}`);
    return;
  }

  console.log(`${c.bold}Configuration:${c.reset}\n`);
  printConfig(config, '');
}

function printConfig(obj: any, prefix: string): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      printConfig(value, fullKey);
    } else {
      console.log(`  ${c.bold}${fullKey}${c.reset} = ${JSON.stringify(value)}`);
    }
  }
}
