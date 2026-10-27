// Pure rules shared by the authoritative service and the editable checkout preview.
export function civilDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.slice(0,4) < '1900') throw new Error('Informe uma data válida.');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0,10) !== value) throw new Error('Informe uma data válida.');
  return value;
}
export function planInstallments(principal, terms, today) {
  const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Confira valores e quantidade de parcelas.'); return value; };
  integer(principal,1,Number.MAX_SAFE_INTEGER);
  const down = integer(terms.downPaymentCents,0,principal), count = integer(terms.installmentCount,0,36), rest=principal-down;
  if ((rest === 0 && count !== 0) || (rest > 0 && (!count || count > rest))) throw new Error('Confira a entrada e as parcelas do restante.');
  const rows=[];
  if(down) rows.push({kind:'down_payment',number:1,count:1,amountCents:down,due:civilDate(terms.downPaymentDue ?? today)});
  if(terms.installmentDueDates !== undefined && (!Array.isArray(terms.installmentDueDates) || terms.installmentDueDates.length !== count)) throw new Error('Confira os vencimentos das parcelas.');
  if(count){
    const first=civilDate(terms.firstDue), [year,month,day]=first.split('-').map(Number), base=Math.floor(rest/count), extra=rest%count;
    for(let i=0;i<count;i++) {
      const target=new Date(Date.UTC(year,month-1+i,1,12)), last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0,12)).getUTCDate();
      target.setUTCDate(Math.min(day,last));
      const due=civilDate(terms.installmentDueDates?.[i] ?? target.toISOString().slice(0,10));
      if(rows.length && due < rows.at(-1).due) throw new Error('Mantenha os vencimentos em ordem.');
      rows.push({kind:'installment',number:i+1,count,amountCents:base+(i<extra?1:0),due});
    }
  }
  return rows;
}
