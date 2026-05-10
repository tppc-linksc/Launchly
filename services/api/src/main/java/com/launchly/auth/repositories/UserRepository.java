package com.launchly.auth.repositories;

import com.launchly.auth.entities.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, String> {
    Optional<User> findByAccount(String account);
    boolean existsByAccount(String account);
    long count();
}
