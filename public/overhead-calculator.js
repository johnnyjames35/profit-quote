(function () {
  var form = document.getElementById('oh-form');
  if (!form) return;
  var out = document.getElementById('oh-result');
  var money = function (n) { return n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' }); };
  function val(id) { return Number(document.getElementById(id).value); }
  window.pqOverheadCalc = function (i) {
    var overheadPerDay = i.overheads / i.billableDays;
    var labour = i.jobDays * i.dayRate;
    var overheadCost = i.jobDays * overheadPerDay;
    var cost = labour + overheadCost + i.materials;
    var price = cost / (1 - i.margin / 100);
    return { overheadPerDay: overheadPerDay, labour: labour, overheadCost: overheadCost, cost: cost, price: price, profit: price - cost, minDayRate: i.dayRate + overheadPerDay };
  };
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var i = { overheads: val('oh-overheads'), billableDays: val('oh-days'), dayRate: val('oh-rate'), jobDays: val('oh-jobdays'), materials: val('oh-materials'), margin: val('oh-margin') };
    var bad = [i.overheads, i.dayRate, i.jobDays, i.materials].some(function (n) { return !isFinite(n) || n < 0; }) || !isFinite(i.billableDays) || i.billableDays < 1 || !isFinite(i.margin) || i.margin < 0 || i.margin >= 100;
    if (bad) { out.textContent = 'Check your figures: costs must be £0 or more, billable days at least 1, and the profit margin between 0% and 99%.'; return; }
    var r = window.pqOverheadCalc(i);
    out.textContent = '';
    [
      ['Overhead to recover each billable day', money(r.overheadPerDay)],
      ['Lowest day rate that covers your pay and overheads', money(r.minDayRate)],
      ['Total cost of this job', money(r.cost) + ' (labour ' + money(r.labour) + ', overheads ' + money(r.overheadCost) + ', materials ' + money(i.materials) + ')'],
      ['Price to charge before VAT', money(r.price)],
      ['Profit left in that price', money(r.profit) + ' (' + i.margin + '% of the price)']
    ].forEach(function (row) {
      var p = document.createElement('p');
      var s = document.createElement('strong');
      s.textContent = row[0] + ': ';
      p.appendChild(s);
      p.appendChild(document.createTextNode(row[1]));
      out.appendChild(p);
    });
  });
})();
