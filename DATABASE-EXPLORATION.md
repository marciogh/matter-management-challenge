# Database exploration

docker exec -it matter-management-db-dev psql -U matter -d matter_db

select * from ticketing_ticket where id = 'e112b699-af32-4f08-8ea7-dc75f91c9d46';

select * from ticketing_ticket_field_value ttfv
join ticketing_fields tf on ttfv.ticket_field_id = tf.id
where ttfv.ticket_id = 'e112b699-af32-4f08-8ea7-dc75f91c9d46'
and tf.name = 'subject'
;

explain analyze
select ttfv.ticket_id, ttfv.text_value from ticketing_ticket_field_value ttfv
join ticketing_fields tf on ttfv.ticket_field_id = tf.id
and tf.name = 'subject' order by ttfv.text_value
;

select name from ticketing_fields where system_field = true;