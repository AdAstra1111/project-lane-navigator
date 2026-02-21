-- Fix misclassified script documents for "How to Rob a Klimt" project
UPDATE project_documents SET doc_type = 'screenplay_draft' WHERE id IN ('2f799024-b827-429e-8c49-11fae7609231', 'b9943fd2-72c6-4838-a93e-621de8c5a646');
UPDATE project_documents SET doc_type = 'screenplay_draft' WHERE id = 'a325574b-7885-4ea5-bee9-89f5bcbe2763';