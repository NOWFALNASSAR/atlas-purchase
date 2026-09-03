ADMIN='["po.view","po.create","po.submit","po.send","po.approve","po.rate_edit","compare.view","reports.view","insights.view","inventory.view","godown.view","godown.edit","transfers.view","transfers.create","transfers.approve","sales.view","sales.branches","sales.salesmen","sales.targets.view","sales.targets.edit","sales.import","tasks.view","tasks.create","tasks.verify","tasks.reports","suppliers.view","suppliers.edit","items.view","items.edit","users.manage","roles.manage","settings.manage"]'
MGR='["po.view","po.create","po.submit","po.send","po.approve","po.rate_edit","compare.view","reports.view","insights.view"]'
EXEC='["po.view","po.create","po.submit","po.send","compare.view","reports.view"]'
ACC='["po.view","compare.view","reports.view"]'
timeout 90 node render2.mjs admin "$ADMIN"
timeout 90 node render2.mjs manager "$MGR"
timeout 90 node render2.mjs executive "$EXEC"
timeout 90 node render2.mjs accounts "$ACC"
timeout 90 node render2.mjs executive '[]'
timeout 90 node render2.mjs manager 'null'
