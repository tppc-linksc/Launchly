package com.launchly.worker.repositories;

import com.launchly.worker.entities.Task;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface TaskRepository extends JpaRepository<Task, String> {

    @Query(value = """
            SELECT * FROM tasks
            WHERE status = 'PENDING' AND attempts < max_attempts
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            """, nativeQuery = true)
    Optional<Task> findNextPendingForUpdate();
}
